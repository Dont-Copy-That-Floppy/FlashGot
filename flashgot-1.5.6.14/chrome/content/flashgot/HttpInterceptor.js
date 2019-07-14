/***** BEGIN LICENSE BLOCK *****

    FlashGot - a Firefox extension for external download managers integration
    Copyright (C) 2004-2013 Giorgio Maone - g.maone@informaction.com

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
                             
***** END LICENSE BLOCK *****/

function HttpInterceptor() {
  CC["@mozilla.org/uriloader;1"].getService(
    CI.nsIURILoader).registerContentListener(this);
}

HttpInterceptor.prototype = {
  
  autoStart: false,
  interceptAll: true,
  bypassAutoStart: false,
  forceAutoStart: false,
  
  lastPost: null, // last uploadChannel
   
  QueryInterface: xpcom_generateQI([
    CI.nsIURIContentListener,
    CI.nsIObserver, 
    CI.nsISupportsWeakReference,
    CI.nsISupports
  ]),
  
  
  setup: function() { // profile initialization
    this.autoStart = fg.getPref("autoStart", false);
    this.interceptAll = fg.getPref("interceptAll", true);
  },
  
  dispose: function() {
    CC["@mozilla.org/uriloader;1"].getService(
        CI.nsIURILoader).unRegisterContentListener(this);
  },
  
  log: function(msg) {
    fg.log(msg);
  },
  
  _shouldIntercept: function(contentType) {
    // dump("FG: _shouldIntercept("+contentType+")\n");
    if (this.bypassAutoStart) return false;
    
    if (!(fg.DMS && fg.DMS.found)) return false;
    if (this.forceAutoStart) return true;
    
    if (!this.autoStart) return false;
    
    if (this.interceptAll &&
      !/\bxpinstall|text|xml|vnd\.mozilla|multipart\/x-mixed-replace\b/.test(contentType)) {
      return true;
    }

    if (contentType == "application/x-unknown-content-type" || /\b(?:xml|rss|javascript|json)\b/.test(contentType)) return false;
    var ms = MediaSniffer.mimeService;
    return fg.extensions.some(function(e) {
      try { return contentType == ms.getTypeFromExtensions(e); } catch(ex) { return false; }
    });
  }
, 
  _willHandle: function(url, contentType) {
    if (!/^(https?|s?ftp|magnet|rtsp|mms|ed2k):/i.test(url) ) {
      if ((/^\s*javascript/i).test(url)) this.log("JavaScript url intercepted: "+url);
      return false;
    }
    return true;
  }
,
  _slurp: function(stream, len) {
    var sis = CC['@mozilla.org/binaryinputstream;1'].createInstance(CI.nsIBinaryInputStream);
    sis.setInputStream(stream);
    return sis.readBytes(len);
  },
  extractPostData: function(channel, res) {
    res = res || {};
    // For the [POST] placeholder - just the POST data, without any
    // POST-related headers injected by the browser (Content-Type,
    // Content-Length, etc.).
    res.postData = null;
    // For the [RAWPOST] placeholder - the POST data with all the POST-related
    // headers injected by the browser, i.e. the entire contents of channel.uploadStream.
    res.rawPostData = null;
    if (channel instanceof CI.nsIUploadChannel &&
       channel.uploadStream instanceof CI.nsISeekableStream) {
      this.log("Extracting post data...");
      try {
        var stream = channel.uploadStream;
        var originalOffset = stream.tell(); 
        stream.seek(2 /* EOF */, 0);
        var size = stream.tell();
        // Extra paranoia mode.
        if (size !== originalOffset) {
          this.log("WARNING: original offset != size: " + originalOffset + ", " + size);
        }
        stream.seek(0, 0);
        var s = this._slurp(stream, size);
        stream.seek(0, originalOffset);
        res.rawPostData = s;

        // extract upload content type
        const headerVisitor = {visitHeader: function(name, value) {
          if ("content-type" === name.toLowerCase()) res.postContentType = value;
        }};
        channel.visitRequestHeaders(headerVisitor);

        // The download manager still has to send the "Range: bytes=0-"
        // header in order to get the file.
        if (/\.grooveshark\.com$/.test(channel.URI.asciiHost)) {
          if (!res.extraHeaders) res.extraHeaders = {};
          res.extraHeaders["Range"] = "bytes=0-";
        }

        // Remove the headers from the POST data. The browser injects
        // Content-Type and Content-Length headers into channel.uploadStream:
        // Content-Type: ... \r\n
        // Content-Length: ... \r\n
        // \r\n
        // <POST data>
        const hdrEndPos = s.indexOf("\r\n\r\n");
        if (hdrEndPos !== -1) {
          var headers = s.substr(0, hdrEndPos).split(/\r\n/);
          var m;
          for (var hdr of headers) {
            m = hdr.match(/^(.+?)\s*:\s*(.+)$/);
            if (!m) continue;
            headerVisitor.visitHeader(m[1], m[2]);
            if (res.postContentType) break;
          }
          s = s.substr(hdrEndPos + 4);
        }
        
        res.postData = s;
      } catch(ex) {
        this.log(ex
          ? (ex.message || ex) + "\n" + (ex.stack || new Error().stack)
          : "Error extracting POST data\n" + new Error().stack
        );
      }
    }
    return res;
  },
  /* nsIURIContentListener */
  
  canHandleContent: function(contentType, isContentPreferred, desiredContentType) {
    // dump("FG: canHandleContent "+contentType+")\n");
    return this._shouldIntercept(contentType);
  }
,
  lastRequest: null,
  doContent: function(contentType, isContentPreferred, channel, contentHandler) {

    channel.QueryInterface(CI.nsIChannel);
    
    if (!(channel.loadFlags & channel.LOAD_DOCUMENT_URI)) throw new Error("FlashGot not interested in non-document loads");
    
    if (fg.DMS[fg.defaultDM].codeName === "_Built_In_") throw new Error("Using built-in, bailing out");
    
    const uri = channel.URI;
    // dump("FG: doContent " +contentType + " " + uri.spec + "\n");
    if (!this._willHandle(uri.spec, contentType)) {
      throw new Error("FlashGot not interested in " + contentType + " from " + uri.spec);
    }
    
    this.log("Intercepting download...");

    const fname = fg.extractFileName(channel) || uri.path.split(/\//).pop();
    var links = [ {
     href: uri.spec,
     fname: fname,
     description: fname,
     noRedir: true
    } ];
    
    
    
    if (channel instanceof CI.nsIHttpChannel) {
      links.referrer = channel.referrer && channel.referrer.spec || "";
      this.extractPostData(channel, links);
    }
    
    try {
        links.document = DOM.findChannelWindow(channel).document;
        links.browserWindow = DOM.getChromeWindow(links.document.defaultView.top);
        if (links.browserWindow.wrappedJSObject) links.browserWindow = links.browserWindow.wrappedJSObject;
      } catch(e) {
        this.log("Can't set referrer document for " + links[0].href + " from " + links.referrer);
    }
    
    var firstAttempt;
    if (contentHandler) {
      this.lastRequest = null;
      firstAttempt = true;
      this.forceAutoStart = false;
    } else {
      var requestLines = [ channel.requestMethod, links[0].href, links.referrer || "", links.postData || ""].join("\n\n");
      firstAttempt = this.lastRequest != requestLines;
      this.lastRequest = requestLines;
    }
    
    if (firstAttempt) {
       var self = this;
       fg.delayExec(function() {
          self.forceAutoStart = false;
          if(fg.download(links))
            self.log("...interception done!");
        }, 10);
    } else {
      // dump("Second attempt, skipping.\n");
      this.lastRequest = null;
      this.forceAutoStart = false;
    }
    
    if (!channel.isPending()) { 
      try {
        channel.requestMethod = "HEAD";
        channel.loadFlags = CI.nsIChannel.LOAD_RETARGETED | CI.nsIChannel.LOAD_RETARGETED_DOCUMENT_URI | CI.nsICachingChannel.LOAD_ONLY_FROM_CACHE;
      } catch(e) {}
    }
    channel.cancel(NS_BINDING_ABORTED); 

    this.log("Original request cancelled.");
    
    return true;
  },
  contentHandler: {
      onStartRequest: function(request, context) { 
        throw "cancelled"; 
      }, 
      onStopRequest: function() {}, 
      onDataAvailable: function() {}
   }
,
  isPreferred: function(contentType, desiredContentType) {
    // dump("FG: isPreferred("+contentType+","+desiredContentType+")\n");
    return this._shouldIntercept(contentType);
  }
,
  onStartURIOpen: function(uri) {
    // dump("FG: onStartURIOpen "+ uri + (uri && uri.spec) + "\n");
    return false;
  }
,
  // http-on-modify-request Observer 
  observe: function(channel, topic, data) {
    if (channel instanceof CI.nsIHttpChannel) {
      
      if (channel instanceof CI.nsIUploadChannel) {
        this.lastPost = channel;
      }
      if (this.forceAutoStart) {
        this.doContent("flashgot/forced", true, channel, null);
        return;
      }
      
      
    }
  }
};