var EXPORTED_SYMBOLS = ["FlashGot"];

const Cc = Components.classes;
const Ci = Components.interfaces;

var FlashGot = {
  download: function(links) {
    let objects = {};
    if ("document" in links) {
      objects.document = links.document;
      delete links.document;
    }
    try {
     Cc["@mozilla.org/childprocessmessagemanager;1"].getService(Ci.nsIMessageSender)
      .sendAsyncMessage("FlashGot::download", { links: links }, objects);
    } finally {
      if ("document" in objects) {
        links.document = objects.document;
      }
    }
  }
}