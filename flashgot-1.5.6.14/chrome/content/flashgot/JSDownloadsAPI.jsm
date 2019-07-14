var EXPORTED_SYMBOLS = ["JSDownloadsAPI"];

const Cu = Components.utils;

function isRequired() {
  Cu.import("resource://gre/modules/Services.jsm");
  try {
    Cu.import("resource://gre/modules/Downloads.jsm");
  } catch (e) { return false; }
  try {
    if (!Services.prefs.getBoolPref("browser.download.useJSTransfer")) return false;
  } catch (e) {}
  try {
    return Services.vc.compare(Services.appinfo.version, "26.0a1") >= 0;
  } catch (e) {}
  return false;
}

function getList(isPrivate) {
  delete this.getList;
  return (this.getList =
    ("getList" in Downloads)
      ? function(p) Downloads.getList(p ? Downloads.PRIVATE : Downloads.PUBLIC)
      : function(p) Downloads[p ? "getPrivateDownloadList" : "getPublicDownloadList"]()
    )(isPrivate);
}

var JSDownloadsAPI = isRequired() && {
  add: function(l, links, targetPath, isPrivate, onError) {
    let src =  {
      url: l.href,
      isPrivate: isPrivate,
      referrer: links.referrer,
    };
    let saver = null;
    let postData = l.postData || links.postData;
    if (postData || l.extraHeaders || l.cacheKey) {
      Cu.import("chrome://flashgot/content/JSDownloadsExtras.jsm");
      src = new FlashgotDownloadSource(src);
      if (postData) src.post = { data: postData, contentType: l.postContentType };
      src.headers = l.extraHeaders || null;
      src.cacheKey = l.cacheKey || null;
      saver = new FlashgotDownloadCopySaver();
    }
    l = null; // needed to free DOM properties and cacheKey
    try {
    Downloads.createDownload({source: src, target: targetPath }
      ).then(
        function(dl) {
          try {
            if (saver) {
              dl.saver = saver;
              saver.download = dl;
            }
            getList(isPrivate).then(
              function(dlist) {
                dlist.add(dl);
              },
              onError);
            dl.start();
          } catch (e) { onError(e) }
        },
        onError
      );
    } catch (e) { onError(e) }
  }
}
|| null;