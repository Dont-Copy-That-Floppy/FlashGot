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

LAZY_INCLUDE("Youtube");
var gFlashGotService = Components.classes["@maone.net/flashgot-service;1"].getService().wrappedJSObject;

var MediaSniffer = {

  QueryInterface: xpcom_generateQI([
    CI.nsIObserver,
    CI.nsISupportsWeakReference,
    CI.nsISupports,
    CI.nsIWebProgressListener
  ]),


  debug: false,
  // http-on-examine-response Observer

  mimeService: CC['@mozilla.org/uriloader/external-helper-app-service;1']
    .getService(CI.nsIMIMEService),
  mediaTypesRx: /\b(?:audio|video|smil|flv)\b|media\b/i,
  badTypesRx: /\b(?:mp2ts?|mpeg-tts|vnd\.mpeg\.dash\.mpd)$/i,
  mediaMap: {
    "asx": "video/x-ms-asx", // fake, see "media" processor
    "flv": "video/flv", // flv is not mapped by MimeService
    "fid": "video/flv", // flv is not mapped by MimeService
    "f4v": "video/mp4",
    "f4a": "video/mp4",
    "f4b": "video/mp4",
    "f4p": "video/mp4",
    "m4v": "video/mp4",
    "mp3": "audio/mp3", // MimeService chokes on this
    "mp4": "video/mp4", // just to be sure :)
    "rm": "application/vnd.rn-realmedia"
  },
  get inverseMediaMap() {
    var m = {};
    for (var p in this.mediaMap) m[this.mediaMap[p]] = p;
    m["flv-application/octet-stream"] =
      m["application/octet-stream"] =
      m["video/x-flv"] = "flv";
    delete this.inverseMediaMap;
    return this.inverseMediaMap = m;
  },

  sniffType: function (channel, forcedContentType) {
    var path = fg.extractFileName(channel) || channel.URI.path;
    path = path.replace(/#[\s\S]*/, '');
    if (path.length > 1024) path = path.substring(0, 1024);
    const extFinder = /([^"/?&]+\.(\w{2,5}))(?=[?&/]|$)/g;
    extFinder.lastIndex = 0;
    var m, ext, ms;
    var contentType = '';
    while ((m = extFinder.exec(path))) {
      ext = m[2];
      if ((contentType = this.mediaMap[ext])) break;
      try {
        contentType = this.mimeService.getTypeFromExtension(ext);
        if (this.mediaTypesRx.test(contentType)) break;
      } catch (e) {}
      contentType = '';
    }

    var fname = m && m[1];
    if (forcedContentType && !(forcedContentType == "video/x-ms-asf" && contentType == "video/x-ms-asx")) {
      if (!fname) {
        fname = (channel.URI instanceof CI.nsIURL) && channel.URI.fileName || path.replace(/.*\//g, '');
        try {
          fname += "." + (this.inverseMediaMap[forcedContentType] || this.mimeService.getPrimaryExtension(forcedContentType, ''));
        } catch (ex) {}
      }
      contentType = forcedContentType;
    }

    if (!(contentType && fname)) return null;
    try {
      fname = decodeURIComponent(fname);
    } catch (e) {
      fname = unescape(fname);
    }
    return {
      fname: fname,
      contentType: contentType
    };
  },

  typesWhitelistRx: /\b(?:x(?:ht)?ml|image|css|j(?:ava(?:script)?|son)|shockwave)\b/i,

  get downloadInterface() {
    delete this.downloadInterface;
    return this.downloadInterface = "nsIHttpActivityObserver" in CI ? CI.nsICancelable : CI.nsIWebBrowserPersist;
  },

  _set_current_url: function (w, url) {
    w._flashgotMediaCurrentUrl = url;
  },

  observe: function (channel, topic, data) {
    if (channel instanceof CI.nsIHttpChannel && Components.isSuccessCode(channel.status)) {
      try {
        // |extras.window|, when |extras| exists as the "flashgot.media.extras"
        // property of |channel|, is never null and always an actual (as opposed
        // to potential - see |yt_win| below) YouTube window - either a top-level
        // one (i.e. a browser tab/window) if we're on YouTube (e.g. /watch?v=VIDEO_ID),
        // or a frame/iframe if we're not on YouTube (e.g. a forum/blog with YouTube
        // embed iframes).
        // |win| is never null and always a top-level window.
        // |yt_win| is never null and always a (potential) YouTube window, i.e. either
        // |win| or |extras.window|.
        // XXX: All the YouTube-related functions (both in MediaSniffer and in Youtube)
        // that want a window as an argument expect a YouTube window, i.e. pass them
        // |yt_win| and not |win|.
        var extras = {}, win, yt_win, media, map, location;
        try {
          if (channel instanceof CI.nsIPropertyBag && channel instanceof CI.nsIWritablePropertyBag) {
            extras = channel.getProperty("flashgot.media.extras").wrappedJSObject || extras;
            win = yt_win = extras.window;
            if (win) {
              channel.deleteProperty("flashgot.media.extras");
              win = win.top;
            }
          }
        } catch (ignore) {}
        if (!win) {
          yt_win = DOM.findChannelWindow(channel) || DOM.mostRecentBrowserWindow && DOM.mostRecentBrowserWindow.content;
          if (!yt_win) return;
          win = yt_win.top;
        }
        media = win._flashgotMedia || (win._flashgotMedia = []);
        location = win.location.href.replace(/#.*/, '');
        if (("_location" in media) && media._location !== location) win._flashgotMedia = media = [];
        media._location = location;
        map = media._map || (media._map = {});

        // Potential YouTube iframe (e.g. /embed/VIDEO_ID).
        // For top-level windows we use onLocationChange.
        if (yt_win !== win
          // No need to check for YouTube (again) if it's our parsed stream.
          && ! extras["flashgot::parsed"]
          // Pass stream URLs through.
          && ! Youtube.is_stream_url(channel.URI.spec)
          // Ignore iframes on YouTube itself (comments iframe atm).
          && ! Youtube.parseVideoId(win.location.href)
          )
        {
          if (this.checkYoutube(yt_win)) { return; }
        }

        // YouTube - 403 Forbidden. Probably the signature algorithm has changed.
        if (channel.responseStatus === 403 && Youtube.is_stream_url(channel.URI.spec))
        {
          fg.log("YouTube 403: video " + extras["flashgot::video_id"] + ": outdated signature function? URL: " + channel.URI.spec);
          if (extras["flashgot::parsed"] && !win.flashgotRefreshedYoutubeSignature) {
            if (fg.getPref("media.YouTube.decode_signature_func.auto", true)
                && (win.flashgotRefreshedYoutubeSignature = 
                      Youtube.refresh_signature_func(yt_win, function() {
                        MediaSniffer.checkYoutube(yt_win, null, true);
                      })
                   )
               ) {
              return;
            }
            
            // Add the "Refresh signature" menu item
            if (!(MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL in map)) {
              media.push(map[MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL] = {
                parsed: true,
                originalURL: MediaSniffer.YOUTUBE_REFRESH_SIGNATURE_FUNC_URL,
                Youtube: Youtube,
                MediaSniffer: MediaSniffer,
                yt_win: yt_win
              });
              this.updateUI(win);
            }
            return;
          }
        }

        // YouTube - for DASH streams (audio/video-only), Content-Type is "application/octet-stream".
        var contentType;
        if (Youtube.is_stream_url(channel.URI.spec) && Math.floor(channel.responseStatus / 100) === 2) {
          // Our parsed stream, or a stream requested by the player.
          // Don't use extras.type because it can be remapped (e.g. "mp4" instead of "video/mp4").
          contentType = this.mediaTypesRx.test(channel.contentType)
            ? channel.contentType
            : Youtube.get_stream_content_type(channel.URI.spec);
          if (Object.keys(map).some(function(url){return !map[url].parsed && Youtube.stream_url_equals(url, channel.URI.spec);})) {
            if ( ! extras["flashgot::parsed"] && ! /^audio\//.test(contentType)) {
              this._set_current_url(win, channel.URI.spec);
            }
            return;
          }
          extras["flashgot::Youtube"] = Youtube; // for flashgotOverlay.js
        }
        if (!contentType) {
          contentType = channel.contentType;
        }
        if (!contentType ||
          (channel instanceof CI.nsIHttpChannel) && channel.responseStatus >= 400 ||
          this.typesWhitelistRx.test(contentType))
        {
          return;
        }

        if (channel.responseStatus === 204 && contentType.indexOf("video/") === 0 ||
          contentType === "application/x-www-form-urlencoded" && /youtube\.com\/get_video_info\?.*el=embedded/.test(channel.name)
        ) {
          this.checkYoutube(yt_win || DOM.findChannelWindow(channel) || DOM.mostRecentBrowserWindow.content, channel.name);
          return;
        }

        if (channel.notificationCallbacks instanceof this.downloadInterface) {
          if (this.debug) dump("Skipping " + channel.name + ": from the built-in download manager or DTA\n" + channel.notificationCallbacks + "\n\n");
          return;
        }

        if (this.debug) dump("Examining " + channel.name + " (" + contentType + ")\n");

        var typeInfo = null;
        if (this.mediaTypesRx.test(contentType) || (typeInfo = this.sniffType(channel))) {

          var url = channel.URI.spec;

          if (this.debug) dump("Media Window: " + win + " - " + win.location.href + " -- " + contentType + "\n");

          var cacheable = true;

          if (/\/frag\(\d+\)\/|&range=\d+-\d+/.test(url)) {
            cacheable = false;
            url = this.normalizeQuery(url.replace(/&range=[^&]*|\/frag\(\d+\)/g, '').replace(/\b(?:cm2|mt)=\d+\b/, ''));
            const goodDMHost = "vid2.ec.dmcdn.net"; // Dailymotion unfragmented-enabled host
            if (url in map || url.replace(/(:\/\/)[^\/]+\.(?:dmcdn\.net|dailymotion\.com)(?=\/)/, "$1" + goodDMHost) in map) return;
            if ( ! extras.window) { extras.window = yt_win; }
            if (this.peek(url, extras, function (xhr) {
              switch (xhr.status) {
              case 403:
                var host = xhr.channel.URI.host;
                if (/\.(?:dmcdn\.net|dailymotion\.com)$/.test(host) && host !== goodDMHost) {
                  var uri = xhr.channel.URI.clone();
                  uri.host = goodDMHost;
                  MediaSniffer.peek(uri.spec, extras);
                }
              }
            })) return;
          } else if ((url in map) && !("cacheKey" in map[url])) {
            media.splice(media.indexOf(map[url], 1));
            delete map[url];
          }

          if (!(url in map)) {

            contentType = contentType.replace(/\s*;.*/, ""); // ignore trailing extras, e.g. charset

            if (/\bx-ms-asf\b/.test(contentType)) {
              try {
                if (channel.contentCharset || channel.contentLength < 16384) contentType = "video/x-ms-asx";
              } catch (e) {}
            }

            // asf content type can also refer to an asx, we need to check the file name to decide
            if (!typeInfo) {
              typeInfo = this.sniffType(channel, contentType)
            }

            contentType = typeInfo.contentType;

            if (/-ms-/.test(contentType) && /(?:\.(?:youtube|ytimg)\.com|doubleclick\.net)$/.test(channel.URI.host)
              && gFlashGotService.getPref("media.skipAds", true))
              return;

            if (this.badTypesRx.test(contentType)) return;

            var contentLength = -1;
            if (cacheable) try {
              contentLength = channel.contentLength;
              if (/\b(?:flv|mp4)\b/.test(contentType) &&
                (channel instanceof CI.nsIHttpChannel) &&
                channel.responseStatus < 300 && // redirects can have 0 length
                contentLength > -1 && contentLength < fg.getPref("media.minSize.flv"))
                return;
            } catch (e) {}

            var humanType = extras.type || contentType;
            if (extras.quality) humanType = extras.quality + " " + humanType;

            // YouTube seek timestamps.
            extras["flashgot::seek_pos"] = 0;
            if (Youtube.is_stream_url(url) && /[?&]begin=(\d+)/.test(url)) {
              extras["flashgot::seek_pos"] = parseInt(RegExp.$1, 10);
            }

            var tip = url.match(/[^\/]*$/)[0] || '';
            if (tip) {
              tip = humanType + ": " + tip;
              if (tip.length > 60) {
                tip = tip.substring(0, 29) + "..." + tip.slice(-28);
              }
            } else tip = humanType;


            var redirect;
            var host = (channel.originalURI || channel.URI).host;
            if (host) {
              host = host.replace(/\./g, '_');
              while (host && (redirect = fg.getPref("media.redirect." + host, -1)) === -1) {
                host = host.replace(/.*?(?:_|$)/, '');
              }
            }
            if (redirect === -1) redirect = fg.getPref("media.redirect", 0); // 0 - no redirect, 1 redirect, 2 include both initial and final url
            if (redirect === 0) url = channel.originalURI && channel.originalURI.spec || url;

            var size = contentLength < 0 ? "???KB"
              : contentLength < 1024 ? (contentLength + "B")
              : contentLength < 1048576 ? (Math.round(contentLength / 1024) + "KB")
              : (Math.round(contentLength / 1048576)) + "MB";

            // Youtube channel hack
            var title_win = fg.getPref("media.use_iframe_title", false) ? yt_win : win;
            var doc = title_win.document;
            var node = doc.getElementById("playnav-curvideo-title");

            var createStrings = function (title, o) {
              if (!title) {
                title = doc._flashGotMediaTitle = doc.title;
                win.setTimeout(function () {
                  if (doc._flashGotMediaTitle !== doc.title) {
                    createStrings(doc._flashGotMediaTitle = doc.title, o);
                    MediaSniffer.updateUI(win);
                  }
                }, 3000);
              }

              var fname = typeInfo.fname || '';

              title = title.replace(/^\s+|\s+$/, '');
              const unicode = fg.getPref("media.unicode") && /^UTF.?8$/i.test(title_win.document.characterSet);
              if (title) {
                const nonWordRx = unicode ? /[\u0000-\u0020\u2000-\u206F\u2E00-\u2E7F]+|[^\w\u0080-\uffff]+/g : /\W+/g;
                // remove site name from title
                title = title.replace(new RegExp("\\b(?:" +
                  (title_win.location.host || '').split(".").filter(function (s) {return s}).join("|") + ")\\b", 'ig'), '')
                  .replace(/https?:\/{2}/gi, '')
                  .replace(nonWordRx, '_')
                  .replace(/^_+([^_])/g, '$1')
                  .replace(/([^_])_+$/g, '$1')
                  .replace(/_+/g, '_');

                if (title.toLowerCase().indexOf(fname.replace(/\.\w+$/, '').replace(nonWordRx, '_').toLowerCase()) !== -1) {
                  fname = fname.replace(/.*(?=\.\w+$)/, '');
                }
              }

              if (title && fg.getPref("media.guessName", true)) {
                fname = (title + "_" + fname)
                  .replace(unicode ? /[^\w\.\u0080-\uffff]+/g : /[^\w\.]+/g, '_')
                  .replace(/_(?:get_video|videoplayback)\b/, '')
                  .replace(/([^_]+)_+(?=\.\w+$)/, '$1');
              }
              if (extras.quality && fname.indexOf(extras.quality) < 0) {
                var dotPos = fname.lastIndexOf(".");
                fname = fname.substring(0, dotPos) + "_" + extras.quality + fname.substring(dotPos);
              }
              if (fname.length > 32) fname = MediaSniffer.limitFName(fname);
              url = o.originalURL || url;
              o.href = (fname && fg.getPref("media.forceNameHack", true) && url.indexOf("#") == -1) ? url + "#/" + encodeURIComponent(fname) : url;
              o.fname = fname;
              o.label = size + " " + humanType + " - " + (fname || tip);
              o.description = title + " (" + size + " " + humanType + ")";
              o.tip = tip + " (" + size + ")";
              return o;
            };

            var title = extras.title || node && node.textContent;

            var entry;
            while (url) {
              media.push(entry = map[url] = createStrings(title, {
                referrer: (channel instanceof CI.nsIHttpChannel) && channel.referrer && channel.referrer.spec,
                contentType: contentType,
                contentLength: contentLength,
                originalURL: url,
                parsed: extras["flashgot::parsed"],
                seek_pos: extras["flashgot::seek_pos"],
                sort_key: extras["flashgot::sort_key"],
                Youtube: extras["flashgot::Youtube"],
                yt_dash: extras["flashgot::yt_dash"],
                video_id: extras["flashgot::video_id"],
                title: extras["flashgot::parsed"] ? extras.title.replace(/^\s+|\s+$/g, "") || ("Video " + extras["flashgot::video_id"]): "",
                video_link: extras["flashgot::video_link"]
              }));
              fg.interceptor.extractPostData(channel, entry); // adds entry.postData if needed
              // YouTube fallback host.
              if (extras["flashgot::parsed"] && extras.fallback_host) {
                var fb_url = url.replace(/^(.+?)\/\/(?:.+?)\//, "$1//" + extras.fallback_host + "/");
                if (fb_url !== url) {
                  entry.fallback_href = fb_url;
                }
              } // YouTube fallback host.
              if (!extras["flashgot::parsed"]) { this._set_current_url(win, url); }

              if (cacheable && (channel instanceof CI.nsICachingChannel))
                entry.cacheKey = channel.cacheKey;

              url = redirect === 2 && (!channel.originalURI || channel.originalURI.spec == url ? null : channel.originalURI.spec);
            }
            this.updateUI(win);
          }
          if (!extras["flashgot::parsed"]) { this._set_current_url(win, url); }
        }
      } catch (e) {
        fg.log("MediaSniffer::observe: exception: [" + typeof(e) + "]: " + (e.message || e) + "\n" + (e.stack || new Error().stack));
        if (!this.debug) return;

        var msg = topic + " " + e.toString() + "\n" + e.stack;
        if (channel) {
          msg += "\__> " + channel.name;
          try {
            msg += ", " + channel.contentType;
          } catch (e1) {}
        }
        dump("*** ERROR ***\n" + msg + "\n\n");
      }
    }
  },
  updateUI: function (win) {
    var bw = DOM.mostRecentBrowserWindow;
    if (bw && bw.gFlashGot && bw.content == win.top) bw.gFlashGot.updateMediaUI();
  },

  get _channelFlags() {
    delete this._channelFlags;
    const constRx = /^[A-Z_]+$/;
    const ff = {};
    [CI.nsIHttpChannel, CI.nsICachingChannel].forEach(function (c) {
      for (var p in c) {
        if (constRx.test(p)) ff[p] = c[p];
      }
    });
    return this._channelFlags = ff;
  },
  humanFlags: function (loadFlags) {
    var hf = [];
    var c = this._channelFlags;
    for (var p in c) {
      if (loadFlags & c[p]) hf.push(p + "=" + c[p]);
    }
    return hf.join("\n");
  },

  limitFName: function (fname) {
    const MAX_FILE_LEN = 128, MAX_EXT_LEN = 5;
    var dotPos = fname.lastIndexOf(".");
    if (dotPos >= MAX_FILE_LEN - MAX_EXT_LEN - 1) {
      var ext = fname.substring(dotPos + 1);
      if (ext.length > MAX_EXT_LEN) ext = ext.substring(0, MAX_EXT_LEN);
      fname = fname.substring(0, MAX_FILE_LEN - 1 - ext.length) + "." + ext;
    } else {
      fname = fname.substring(0, MAX_FILE_LEN);
    }
    return fname;
  },
  normalizeQuery: function (url) {
    var parts = url.split("?");
    if (parts.length < 2) return url;
    var qs = parts[1].split("&");
    qs.sort();
    return parts[0] + "?" + qs.join("&");
  },
  onStateChange: function (wp, channel, stateFlag, status) {
    // here we wait STATE_STOP of cached channels
    if (Components.isSuccessCode(status) && (stateFlag & 16) && (channel instanceof CI.nsICachingChannel))
      this.observe(channel, "http-cached-stop", null);
  },
  onLocationChange: function (wp, req, location) {
    wp.DOMWindow.setTimeout(function() { MediaSniffer.checkYoutube(this) }, 1000);
  },
  onLinkIconAvailable: function () {},
  onStatusChange: function () {},
  onSecurityChange: function () {},
  onProgressChange: function () {},

  YOUTUBE_REFRESH_SIGNATURE_FUNC_URL: "flashgot::Youtube::refresh_signature_func",
  // @param w
  //   a YouTube window - either a top-level window if we're on YouTube.com,
  //   or an embed iframe if we're on a forum/blog or something.
  checkYoutube: function(yt_win, url, force) {
    if (!gFlashGotService.getPref("media.YouTube.autodetect", true)) { return false; }
    var id = Youtube.parseVideoId(url || yt_win.location.href);
    if (!id) return false;

    var w = yt_win.top;
    var yids = !force && w._flashGotYoutubeIds || (w._flashGotYoutubeIds = []);
    var sid = String(id);
    if (yids.indexOf(sid) !== -1) return true;
    yids.push(sid);

    Youtube.process(yt_win, id, function (data) {
      if (!data) return;
      var title = data.title;
      data.streams.forEach(function (s) {
        s.title = title;
        s.type = s.type.split(";")[0] || "Media";
        s.window = yt_win;
        s["flashgot::parsed"] = true;
        MediaSniffer.peek(s.url, s);
      });
    }, fg.isPrivate(w));
    return true;
  },
  peek: function (url, extras, callback) {
    try {
      var xhr = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
      xhr.open("HEAD", url);
      var ch = xhr.channel;
      if (!(ch instanceof CI.nsIHttpChannel && ch instanceof CI.nsIWritablePropertyBag)) return false;
      if (!extras.wrappedJSObject) extras.wrappedJSObject = extras;
      ch.setProperty("flashgot.media.extras", extras);
      if (extras.window && fg.isPrivate(extras.window)) {
        fg.privatize(ch);
      }
      // The channel |ch| will be lost (changed) in case of a redirect (3xx),
      // so we must listen for redirects in order to preserve our |extras|.
      ch.notificationCallbacks = {
        // nsIInterfaceRequestor methods.
        getInterface: function (uuid) {
          if (uuid.equals(CI.nsIInterfaceRequestor) || uuid.equals(CI.nsIChannelEventSink)) {
            return this;
          }
          throw Components.results.NS_ERROR_NO_INTERFACE;
        },

        // nsIChannelEventSink methods.
        asyncOnChannelRedirect: function (oldChannel, newChannel, flags, callback) {
          newChannel.notificationCallbacks = this;
          try {
            newChannel.QueryInterface(Components.interfaces.nsIWritablePropertyBag)
              .setProperty("flashgot.media.extras", extras);
          } catch (x) {
            fg.log("MediaSniffer::peek: " + (extras["flashgot::video_id"] ? "video " + extras["flashgot::video_id"] + ": " : "") + "failed to preserve extras: " + (x.message || x) + "\n" + x.stack);
          }
          if (callback != null && "onRedirectVerifyCallback" in callback) {
            callback.onRedirectVerifyCallback(Components.results.NS_OK);
          }
        },

        // Deprecated.
        onChannelRedirect: function (oldChannel, newChannel, flags) {
          this.asyncOnChannelRedirect(oldChannel, newChannel, flags, null);
        }
      }; // ch.notificationCallbacks
      xhr.addEventListener("readystatechange", function (ev) {
        if (xhr.readyState < 2) return;
        try {
          if (callback) callback(xhr);
        } finally {
          xhr.abort();
        }
      }, false);
      xhr.send(null);
      return true;
    } catch (e) {
      fg.log(e);
    }
    return false;
  }
};
