var EXPORTED_SYMBOLS = [
  "FlashgotDownloadSource",
  "FlashgotDownloadCopySaver"
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/DownloadCore.jsm");
Cu.import("resource://gre/modules/Downloads.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "DownloadIntegration",
                                  "resource://gre/modules/DownloadIntegration.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
                                  "resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm")
XPCOMUtils.defineLazyModuleGetter(this, "Promise",
                                  "resource://gre/modules/commonjs/sdk/core/promise.js");
XPCOMUtils.defineLazyModuleGetter(this, "Task",
                                  "resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "gDownloadHistory",
           "@mozilla.org/browser/download-history;1",
           Ci.nsIDownloadHistory);
XPCOMUtils.defineLazyServiceGetter(this, "gExternalHelperAppService",
           "@mozilla.org/uriloader/external-helper-app-service;1",
           Ci.nsIExternalHelperAppService);

const BackgroundFileSaverStreamListener = Components.Constructor(
      "@mozilla.org/network/background-file-saver;1?mode=streamlistener",
      "nsIBackgroundFileSaver");



/**
 * Returns true if the given value is a primitive string or a String object.
 */
function isString(aValue) {
  // We cannot use the "instanceof" operator reliably across module boundaries.
  return (typeof aValue == "string") ||
         (typeof aValue == "object" && "charAt" in aValue);
}



////////////////////////////////////////////////////////////////////////////////
// Supports POST data and custom headers support.
// class FlashgotDownloadSource extends DownloadSource {
//   Post post;
//   Map<string, string> headers;
//
//   struct Post {
//     string data;
//     string contentType;
//   }
// }
// FlashgotDownloadSource(Object serializable = null);
function FlashgotDownloadSource(o /*= null*/) {
  if (!o) { return; }
  this.url = o.url;
  this.isPrivate = o.isPrivate;
  this.referrer = o.referrer;
  this.post = o.post;
  this.headers = o.headers;
}

FlashgotDownloadSource.prototype = {
  __proto__: DownloadSource.prototype,

  post: null,
  headers: null,

  // @override
  toSerializable: function() {
    return {
      url: this.url,
      isPrivate: this.isPrivate,
      referrer: this.referrer,
      post: this.post,
      headers: this.headers
    };
  }
};

FlashgotDownloadSource.fromSerializable = function(o) {
  return new FlashgotDownloadSource(o);
};


////////////////////////////////////////////////////////////////////////////////
// class FlashgotDownloadCopySaver extends DownloadCopySaver
// Supports POST data and custom headers support.
function FlashgotDownloadCopySaver() {}

FlashgotDownloadCopySaver.prototype = {
  __proto__: DownloadCopySaver.prototype,

  // @override
  execute: function DCS_execute(aSetProgressBytesFn, aSetPropertiesFn) {
    try {
      let copySaver = this;
      this._canceled = false;
  
      let download = this.download;
      let targetPath = download.target.path;
      let partFilePath = download.target.partFilePath;
      let keepPartialData = download.tryToKeepPartialData;
  
      return Task.spawn(function task_DCS_execute() {
        // Add the download to history the first time it is started in this
        // session.  If the download is restarted in a different session, a new
        // history visit will be added.  We do this just to avoid the complexity
        // of serializing this state between sessions, since adding a new visit
        // does not have any noticeable side effect.
        if (!this.alreadyAddedToHistory) {
          this.addToHistory();
          this.alreadyAddedToHistory = true;
        }
  
        // To reduce the chance that other downloads reuse the same final target
        // file name, we should create a placeholder as soon as possible, before
        // starting the network request.  The placeholder is also required in case
        // we are using a ".part" file instead of the final target while the
        // download is in progress.
        try {
          // If the file already exists, don't delete its contents yet.
          let file = yield OS.File.open(targetPath, { write: true });
          yield file.close();
        } catch (ex if ex instanceof OS.File.Error) {
          // Throw a DownloadError indicating that the operation failed because of
          // the target file.  We cannot translate this into a specific result
          // code, but we preserve the original message using the toString method.
          let error = new DownloadError(Cr.NS_ERROR_FAILURE, ex.toString());
          error.becauseTargetFailed = true;
          throw error;
        }
  
        try {
          let deferSaveComplete = Promise.defer();
  
          if (this._canceled) {
            // Don't create the BackgroundFileSaver object if we have been
            // canceled meanwhile.
            throw new DownloadError(Cr.NS_ERROR_FAILURE, "Saver canceled.");
          }
  
          // Create the object that will save the file in a background thread.
          let backgroundFileSaver = new BackgroundFileSaverStreamListener();
          try {
            // When the operation completes, reflect the status in the promise
            // returned by this download execution function.
            backgroundFileSaver.observer = {
              onTargetChange: function () { },
              onSaveComplete: function DCSE_onSaveComplete(aSaver, aStatus)
              {
                // Free the reference cycle, to release resources earlier.
                backgroundFileSaver.observer = null;
                this._backgroundFileSaver = null;
  
                // Send notifications now that we can restart if needed.
                if (Components.isSuccessCode(aStatus)) {
                  deferSaveComplete.resolve();
                } else {
                  // Infer the origin of the error from the failure code, because
                  // BackgroundFileSaver does not provide more specific data.
                  deferSaveComplete.reject(new DownloadError(aStatus, null,
                                                             true));
                }
              },
            };
  
            // Create a channel from the source, and listen to progress
            // notifications.
            let channel = NetUtil.newChannel(NetUtil.newURI(download.source.url));
            if (channel instanceof Ci.nsIPrivateBrowsingChannel) {
              channel.setPrivate(download.source.isPrivate);
            }
            if (channel instanceof Ci.nsIHttpChannel) {
              if (download.source.referrer) {
                channel.referrer = NetUtil.newURI(download.source.referrer);
              }
              if (download.source.post) {
                let post = download.source.post;
                let sis = Cc["@mozilla.org/io/string-input-stream;1"]
                  .createInstance(Ci.nsIStringInputStream);
                sis.setData(post.data, post.data.length);
                channel.QueryInterface(Ci.nsIUploadChannel)
                  .setUploadStream(sis, post.contentType || null, -1);
                // The order is important - setUploadStream resets to PUT.
                channel.requestMethod = "POST";
              }
              if (download.source.headers) {
                let headers = download.source.headers;
                for (let p in headers) {
                  channel.setRequestHeader(p, headers[p], false /*don't merge, overwrite*/);
                }
              }
            }
            
            if (download.source.cacheKey && (channel instanceof Ci.nsICachingChannel)) {
              channel.cacheKey = download.source.cacheKey;
              delete download.source.cacheKey;
            }
            // If we have data that we can use to resume the download from where
            // it stopped, try to use it.
            let resumeAttempted = false;
            let resumeFromBytes = 0;
            if (channel instanceof Ci.nsIResumableChannel && this.entityID &&
                partFilePath && keepPartialData) {
              try {
                let stat = yield OS.File.stat(partFilePath);
                channel.resumeAt(stat.size, this.entityID);
                resumeAttempted = true;
                resumeFromBytes = stat.size;
              } catch (ex if ex instanceof OS.File.Error &&
                             ex.becauseNoSuchFile) { }
            }
  
            channel.notificationCallbacks = {
              QueryInterface: XPCOMUtils.generateQI([Ci.nsIInterfaceRequestor]),
              getInterface: XPCOMUtils.generateQI([Ci.nsIProgressEventSink]),
              onProgress: function DCSE_onProgress(aRequest, aContext, aProgress,
                                                   aProgressMax)
              {
                let currentBytes = resumeFromBytes + aProgress;
                let totalBytes = aProgressMax == -1 ? -1 : (resumeFromBytes +
                                                            aProgressMax);
                aSetProgressBytesFn(currentBytes, totalBytes, aProgress > 0 &&
                                    partFilePath && keepPartialData);
              },
              onStatus: function () { },
            };
  
            // Open the channel, directing output to the background file saver.
            backgroundFileSaver.QueryInterface(Ci.nsIStreamListener);
            channel.asyncOpen({
              onStartRequest: function (aRequest, aContext) {
                backgroundFileSaver.onStartRequest(aRequest, aContext);
  
                aSetPropertiesFn({ contentType: channel.contentType });
  
                // Ensure we report the value of "Content-Length", if available,
                // even if the download doesn't generate any progress events
                // later.
                if (channel.contentLength >= 0) {
                  aSetProgressBytesFn(0, channel.contentLength);
                }
  
                // If the URL we are downloading from includes a file extension
                // that matches the "Content-Encoding" header, for example ".gz"
                // with a "gzip" encoding, we should save the file in its encoded
                // form.  In all other cases, we decode the body while saving.
                if (channel instanceof Ci.nsIEncodedChannel &&
                    channel.contentEncodings) {
                  let uri = channel.URI;
                  if (uri instanceof Ci.nsIURL && uri.fileExtension) {
                    // Only the first, outermost encoding is considered.
                    let encoding = channel.contentEncodings.getNext();
                    if (encoding) {
                      channel.applyConversion =
                        gExternalHelperAppService.applyDecodingForExtension(
                                                  uri.fileExtension, encoding);
                    }
                  }
                }
  
                if (keepPartialData) {
                  // If the source is not resumable, don't keep partial data even
                  // if we were asked to try and do it.
                  if (aRequest instanceof Ci.nsIResumableChannel) {
                    try {
                      // If reading the ID succeeds, the source is resumable.
                      this.entityID = aRequest.entityID;
                    } catch (ex if ex instanceof Components.Exception &&
                                   ex.result == Cr.NS_ERROR_NOT_RESUMABLE) {
                      keepPartialData = false;
                    }
                  } else {
                    keepPartialData = false;
                  }
                }
  
                if (partFilePath) {
                  // If we actually resumed a request, append to the partial data.
                  if (resumeAttempted) {
                    // TODO: Handle Cr.NS_ERROR_ENTITY_CHANGED
                    backgroundFileSaver.enableAppend();
                  }
  
                  // Use a part file, determining if we should keep it on failure.
                  backgroundFileSaver.setTarget(new FileUtils.File(partFilePath),
                                                keepPartialData);
                } else {
                  // Set the final target file, and delete it on failure.
                  backgroundFileSaver.setTarget(new FileUtils.File(targetPath),
                                                false);
                }
              }.bind(copySaver),
  
              onStopRequest: function (aRequest, aContext, aStatusCode) {
                try {
                  backgroundFileSaver.onStopRequest(aRequest, aContext,
                                                    aStatusCode);
                } finally {
                  // If the data transfer completed successfully, indicate to the
                  // background file saver that the operation can finish.  If the
                  // data transfer failed, the saver has been already stopped.
                  if (Components.isSuccessCode(aStatusCode)) {
                    if (partFilePath) {
                      // Move to the final target if we were using a part file.
                      backgroundFileSaver.setTarget(
                                          new FileUtils.File(targetPath), false);
                    }
                    backgroundFileSaver.finish(Cr.NS_OK);
                  }
                }
              }.bind(copySaver),
  
              onDataAvailable: function (aRequest, aContext, aInputStream,
                                         aOffset, aCount) {
                backgroundFileSaver.onDataAvailable(aRequest, aContext,
                                                    aInputStream, aOffset,
                                                    aCount);
              }.bind(copySaver),
            }, null);
  
            // If the operation succeeded, store the object to allow cancellation.
            this._backgroundFileSaver = backgroundFileSaver;
          } catch (ex) {
            // In case an error occurs while setting up the chain of objects for
            // the download, ensure that we release the resources of the saver.
            backgroundFileSaver.finish(Cr.NS_ERROR_FAILURE);
            throw ex;
          }
  
          // We will wait on this promise in case no error occurred while setting
          // up the chain of objects for the download.
          yield deferSaveComplete.promise;
        } catch (ex) {
          // Ensure we always remove the placeholder for the final target file on
          // failure, independently of which code path failed.  In some cases, the
          // background file saver may have already removed the file.
          try {
            yield OS.File.remove(targetPath);
          } catch (e2 if e2 instanceof OS.File.Error && e2.becauseNoSuchFile) { }
          throw ex;
        }
      }.bind(this));
    } catch(x){
      Components.utils.reportError("FlashgotDownloadCopySaver::execute: exception: "
        + (x ? (x.message || x) + "\n" + (x.stack || new Error().stack): x));
    }
    return null;
  },


  // @override
  toSerializable: function() this.entityID ? { type: "flashgot", entityID: this.entityID } : "flashgot"
  
};

