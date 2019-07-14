const APP_DISPLAY_NAME = "FlashGot";
const APP_NAME = "flashgot";
const APP_PACKAGE = "/informaction/flashgot";
const APP_VERSION = "1.5.6.14rc1";

const APP_PREFS_FILE="defaults/preferences/flashgot.js";
const APP_XPCOM_SERVICE="components/flashgotService.js";
const APP_JAR_FILE = "flashgot.jar";
const APP_CONTENT_FOLDER = "content/flashgot/";
const APP_LOCALES = ["ar",
                     "be-BY", "bg-BG",
                     "ca-AD", "cs-CZ",
                     "da-DK", "de",
                     "el-GR", "en-US", "es-AR", "es-CL", "es-ES",
                     "fa-IR", "fi-FI", "fr",
                     "gl-ES", "he-IL",
                     "hi-IN", "hr-HR", "hu",
                     "id-ID", "it-IT",
                     "ja-JP", "km-KH", "ko-KR",
                     "lt-LT",
                     "mn-MN",
                     "nb-NO", "nl",
                     "pl", "pt-BR", "pt-PT",
                     "ro-RO", "ru",
                     "sk-SK", "sl-SI", "sq-AL", "sr", "sv-SE",
                     "th-TH", "tr-TR",
                     "uk",
                     "vi",
                     "zh-CN", "zh-TW"];


const APP_SUCCESS_MESSAGE = APP_DISPLAY_NAME+" should now be available in your context menu when you restart Mozilla.";

var instToProfile = false;

myPerformInstall(false);

function myPerformInstall(secondTry) {
  
  var err;
  initInstall(APP_NAME, APP_PACKAGE, APP_VERSION);
  
  var err;
  initInstall(APP_NAME, APP_PACKAGE, APP_VERSION);
  var profChrome = getFolder("Profile", "chrome");
  if(!secondTry) {  
    File.remove(getFolder(profChrome, APP_JAR_FILE));
  }

  var chromef = instToProfile ? profChrome : getFolder("chrome");
  err = addFile(APP_PACKAGE, APP_VERSION, "chrome/" + APP_JAR_FILE, chromef, null);
   
  if(APP_PREFS_FILE && (err == SUCCESS) ) {
    const prefDirs=[
      getFolder(getFolder("Profile"),"pref"),
      getFolder(getFolder(getFolder("Program"),"defaults"),"pref")
      ];
    for(var j=prefDirs.length; j-->0;) {
      var prefDir=prefDirs[j];
      if(!File.exists(prefDir)) {
        File.dirCreate(prefDir);
      }
      err = addFile(APP_PACKAGE, APP_VERSION,  APP_PREFS_FILE, prefDir, null, true);
      logComment("Adding "+APP_PREFS_FILE+" in "+prefDir+": exit code = "+err);
    }
  }
  
  if(err == SUCCESS) {
    var jar = getFolder(chromef, APP_JAR_FILE);
    const chromeFlag=instToProfile?PROFILE_CHROME:DELAYED_CHROME;
  
    registerChrome(CONTENT | chromeFlag, jar, APP_CONTENT_FOLDER);
    var localesCount = APP_LOCALES.length;
    var locale;
    while(localesCount-- > 0) {
      locale = APP_LOCALES[localesCount];
      registerChrome(LOCALE | chromeFlag, jar,
          locale == 'en-US'
            ? "content/flashgot/" + locale + "/"
            : "locale/" + locale + "/flashgot/"
          ); 
    }
    
    registerChrome(SKIN | chromeFlag, jar, "skin/classic/flashgot/");
    
    
    if(APP_XPCOM_SERVICE) {
      var componentsDir = getFolder("Components");
      /*
      if (!(APP_XPCOM_SERVICE instanceof Array)) {
        APP_XPCOM_SERVICE = [APP_XPCOM_SERVICE];
      }
      for (var s = APP_XPCOM_SERVICE.length; s-- > 0;)
        addFile(APP_PACKAGE,APP_VERSION, APP_XPCOM_SERVICE[s], componentsDir, null, true);
      */
      addFile(APP_PACKAGE,APP_VERSION, APP_XPCOM_SERVICE, componentsDir, null, true);
      addFile(APP_NAME, "components/.autoreg", getFolder("Program"), "");
    }
    
    err = performInstall();
    if(err == -239 && !secondTry) {
      alert("Chrome registration problem, maybe transient, retrying...");
      cancelInstall(err);
      myPerformInstall(true);
      return;
    }
    if(err == SUCCESS || err == 999) {
      alert(APP_DISPLAY_NAME+" "+APP_VERSION+" has been succesfully installed in your " + 
          (instToProfile ? "profile" : "browser") +
          ".\n" + APP_SUCCESS_MESSAGE);
    } else {
      var msg = "Install failed!!! Error code:" + err;

      if(err == -239) {
        msg += "\nThis specific error is usually transient:"
          +"\nif you retry to install again, it will probably go away."
      }

      alert(msg);
      cancelInstall(err);
    }
  } else {
    alert("Failed to create " +APP_JAR_FILE +"\n"
      +"You probably don't have appropriate permissions \n"
      +"(write access to your profile or chrome directory). \n"
      +"_____________________________\nError code:" + err);
    cancelInstall(err);
  }
}