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

var Youtube = function(){

///////////////////////////////////////////////////////////////////////////////
// Public part.
var Youtube = {

  VIDEO_ID_TYPE_YOUTUBE: "youtube",
  VIDEO_ID_TYPE_GOOGLE: "google",
  parseVideoId: function (url) {
    var ioService = Components.classes["@mozilla.org/network/io-service;1"]
      .getService(Components.interfaces.nsIIOService);
    var uri = ioService.newURI(url, null, null);
    // Accessing uri.host throws for urls like "about:blank".
    // Accessing uri.asciiHost doesn't throw.
    if (!/^https?$/i.test(uri.scheme)) { return null; }

    var rc = {
      type: this.VIDEO_ID_TYPE_YOUTUBE,
      value: "",
      // For MediaSniffer.
      toString: function(){return this.type + ":" + this.value;}
    };

    // YouTube.
    if (/(?:^|\.)youtube\.com$/.test(uri.asciiHost)) {
      var s = uri.path.replace(/#.*$/, "").replace(/^\//, "");
      // /watch?v=VIDEO_ID
      if (/^watch\?/.test(s)) { return /[?&]v=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      // /v/VIDEO_ID, /embed/VIDEO_ID
      if (/^(?:v|embed)\/([^?\/]+)/.test(s)) { rc.value = RegExp.$1; return rc; }
      // /get_video_info?video_id=VIDEO_ID, /get_video?video_id=VIDEO_ID
      if (/^get_video(?:_info)?\?/.test(s)) { return /[?&]video_id=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      // /api_video_info?video_id=VIDEO_ID
      if (/^api_video_info\?/.test(s)) { return /[?&]video_id=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      return null;
    }
    // https://youtube.googleapis.com/v/VIDEO_ID - youtube.com/v/VIDEO_ID redirects here.
    if ("youtube.googleapis.com" === uri.asciiHost && /^\/v\/([^?#\/]+)/.test(uri.path)) {
      rc.value = RegExp.$1;
      return rc;
    }

    // Google Drive.
    if (/(?:^|\.)docs\.google\.com$/.test(uri.asciiHost)) {
      rc.type = this.VIDEO_ID_TYPE_GOOGLE;
      var s = uri.path.replace(/#.*$/, "").replace(/^\//, "");
      // /file/d/VIDEO_ID
      if (/^file\/d\/([^?\/]+)/.test(s)) { rc.value = RegExp.$1; return rc; }
      // /uc?id=VIDEO_ID
      if (/^uc\?/.test(s)) { return /[?&]id=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      // /get_video_info?docid=VIDEO_ID
      if (/^get_video_info\?/.test(s)) { return /[?&]docid=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      return null;
    }
    // Google Videos or whatever that thing is - SWF in the "preview"
    // embed iframe (docs.google.com/file/d/VIDEO_ID/preview) for a file
    // in Google Drive.
    if (/(?:^|\.)video\.google\.com$/.test(uri.asciiHost)) {
      rc.type = this.VIDEO_ID_TYPE_GOOGLE;
      var s = uri.path.replace(/#.*$/, "").replace(/^\//, "");
      // /get_player?docid=VIDEO_ID
      if (/^get_player\?/.test(s)) { return /[?&]docid=([^&]+)/.test(s) ? (rc.value = RegExp.$1, rc) : null; }
      return null;
    }

    // embedly.com.
    if (arguments.callee && arguments.callee.caller && arguments.callee !== arguments.callee.caller
      && /(?:^|\.)embedly\.com$/.test(uri.asciiHost)
      && /^\/widgets\/media\.html/.test(uri.path)
      && /[?&](?:src|url)=([^&#]+)/.test(uri.path)
      )
    {
      return arguments.callee.call(this, decodeURIComponent(RegExp.$1));
    }
    return null;
  },

  process: function (w, id, callback, isPrivate) {
    // Reentrance guard for do_xhr.
    w["flashgot::Youtube::process::call_cnt"] = (w["flashgot::Youtube::process::call_cnt"] || 0) + 1;

    if (id.type === Youtube.VIDEO_ID_TYPE_GOOGLE) {
      // Just like with YouTube, in some cases all the stream
      // data we need is already present in the document.
      // The problem is that it's not stored in a variable but
      // inlined as an argument in a function call (_initProjector).
      // And even if it wasn't, it's just arrays of arrays, without
      // any named objects, so we'd end up dealing with a bunch of
      // magic numbers (indices) if we were parsing it, so screw it.
      return Youtube.do_xhr(w, id, callback, isPrivate);
    }

    // First try to extract the stream data from the document:
    // either from ytplayer.config.args.url_encoded_fmt_stream_map
    // or from the player's flashvars.
    // If that fails, retry with /get_video_info.
    // XXX: The problem with using /get_video_info is that it allows
    // you to bypass the "This video is age-restricted" warning. But
    // I guess it's their problem that their script doesn't check what
    // it should check. Or did they leave that backdoor on purpose?
    // Or it's not a backdoor and the response contains some kind of
    // an "age-restricted" flag that the client must check?
    // You also can bypass it with /v/VIDEO_ID and /embed/VIDEO_ID.
    if (w["flashgot::Youtube::process::tid"]) {
      w.clearTimeout(w["flashgot::Youtube::process::tid"]);
      delete w["flashgot::Youtube::process::tid"];
    }

    function wait_for_player() {
      delete w["flashgot::Youtube::process::tid"];

      var now = Date.now();
      if (!arguments.callee["flashgot::start_time"]) {
        arguments.callee["flashgot::start_time"] = now;
      }
      if (now - arguments.callee["flashgot::start_time"] > 5000) {
        Youtube.do_xhr(w, id, callback, isPrivate);
        return;
      }
      var data;
      var o;
      // ytplayer.config.args
      if (!data && (o = w.wrappedJSObject) && (o = o.ytplayer) && (o = o.config) && (o = o.args) && o.url_encoded_fmt_stream_map) {
        data = o;
      }
      // <embed/> flashvars
      if (!data && (o = w.document)) {
        var ids = gFlashGotService.getPref("media.YouTube.flashvars_element_id", "movie_player").split(/\s*,\s*/).map(unescape);
        var attrs = gFlashGotService.getPref("media.YouTube.flashvars_element_attr", "flashvars").split(/\s*,\s*/).map(unescape);
        ids.some(function(id){
          if ( ! id.length) { return; }
          var elm = o.getElementById(id);
          return elm !== null && attrs.some(function(attr){
            return attr.length && (attr = elm.getAttribute(attr))
              && (data = Youtube.parse(attr)) && data.url_encoded_fmt_stream_map
              ? data : (data = null);
          });
        });
      }
      if (!data) {
        // The document is loaded, but still no data - no point in waiting further
        // (e.g. /embed/VIDEO_ID documents don't have the data we're looking for).
        if (w.document && w.document.readyState && (w.document.readyState === "interactive" || w.document.readyState === "complete")) {
          Youtube.do_xhr(w, id, callback, isPrivate);
        }
        else {
          w["flashgot::Youtube::process::tid"] = w.setTimeout(arguments.callee, 200);
        }
        return;
      }
      if (Youtube.process_video_info(data, callback, isPrivate)) {
        delete w["flashgot::Youtube::process::call_cnt"];
        return;
      }
      Youtube.do_xhr(w, id, callback, isPrivate);
    } // wait_for_player()
    w["flashgot::Youtube::process::tid"] = w.setTimeout(wait_for_player, 0);
  },

  do_xhr: function (w, id, callback, isPrivate) {
    var call_cnt = w["flashgot::Youtube::process::call_cnt"];

    var url = id.type === this.VIDEO_ID_TYPE_YOUTUBE
      ? w.location.protocol + "//www.youtube.com/get_video_info?hl=en_US&el=detailpage&video_id="
        + id.value + "&sts=" + fg.getPref("media.YouTube.decode_signature_func.timestamp", -1)
      : w.location.protocol + "//docs.google.com/get_video_info?docid=" + id.value;
    var xhr = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    xhr.open("GET", url);
    if (isPrivate) {
      fg.privatize(xhr.channel);
    }
    xhr.addEventListener("readystatechange", function (ev) {
      if (w["flashgot::Youtube::process::call_cnt"] !== call_cnt) {
        this.abort();
        return;
      };
      if (xhr.readyState !== 4) return;
      delete w["flashgot::Youtube::process::call_cnt"];
      Youtube.process_video_info(Youtube.parse(xhr.responseText || ""), callback, isPrivate);
    }, false);
    xhr.send(null);
  },

  parse: function (s) {
    var pairs = s.split("&");
    var res = {};
    var nv;
    for (var p of pairs) {
      try {
        nv = p.split("=").map(function(v) { return decodeURIComponent(v.replace(/\+/g, ' ')) });
        if (!(nv[0] in res)) res[nv[0]] = nv[1];
      } catch (e) {}
    }
    return res;
  },

  process_video_info: function (data, callback, isPrivate) {
    if (!data || !data.url_encoded_fmt_stream_map) { return false; }
    var streams = data.url_encoded_fmt_stream_map.split(",").map(Youtube.parse);

    // 2013-10: 1080p is not in the map anymore (and some other formats as well).
    if (data.adaptive_fmts) {
      data.adaptive_fmts.split(",").map(Youtube.parse).forEach(function(o){
        var b = o.itag && o.type && o.url
          && (o.quality = o.size || /*audio*/(Math.round(o.bitrate / 1024) + "k"));
        if (b) {
          o["flashgot::yt_dash"] = o.size ? "video" : "audio";
          streams.push(o);
        }
      });
    }

    // Get streams from the DASH manifest.
    if ( ! data.dashmpd) {
      return Youtube.process_streams(data, streams, callback);
    }
    // Decode the signature. The same thing as with streams: "signature" = as-is, "s" = encoded.
    // |data| can point to the content window's object, and we don't want to change it.
    var dashmpd = new String(data.dashmpd);
    var re = /\/s\/([^\/?#]+)/;
    if (re.test(dashmpd)) {
      var sig = decodeURIComponent(RegExp.$1);
      var sd;
      try {
        sd = Youtube.create_signature_decoder();
        sig = sd.decode({stream: {s: sig}, video_info: data, swap: Youtube.decode_signature_swap});
        if (sig) {
          dashmpd = dashmpd.replace(re, "/signature/" + encodeURIComponent(sig));
        }
      } catch (x) {
        fg.log("Error decoding DASH manifest signature: " + (x.message || x) + (x.stack || new Error().stack));
        return Youtube.process_streams(data, streams, callback);
      }
      finally {
        if (sd) { sd.dispose(); }
      }
    }
    var xhr = CC["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(CI.nsIXMLHttpRequest);
    xhr.open("GET", dashmpd);
    xhr.overrideMimeType("text/xml");
    if (isPrivate) { fg.privatize(xhr.channel); }
    xhr.addEventListener("readystatechange", function (ev) {
      if (this.readyState !== 4) return;
      Youtube.get_dashmpd_streams(this.responseXML, data, streams);
      Youtube.process_streams(data, streams, callback);
    }, false);
    xhr.send(null);

    // FIXME: Youtube::process::wait_for_player() relies on the return value.
    // Always returning true means wait_for_player() will never call do_xhr()
    // after it called us.
    return true;
  },

  process_streams: function(data, streams, callback) {
    if (!streams.length) { return false; }

    // Preprocess the streams:
    // 1) Mark 3D videos. MediaSniffer uses .quality ("small" (240p), "medium" (360p),
    // "hd720", etc.) and .type ("video/flv", "video/mp4", etc.) for formatting menu
    // item labels and tooltips.
    // 2) Decode the stream signatures.
    // 3) Build the sort keys. Don't sort right here,
    // because the responses can arrive in any order.
    // 4) Store unknown itags.
    var data_title = String(data.title);
    var signature_decoder;
    try {
      signature_decoder = this.create_signature_decoder();
    } catch (x) {
      fg.log("Error creating signature decoder: " + (x.message || x) + "\n" + x.stack);
      return false;
    }
    // true = use the "XXXp" notation for video ("720p", "480p", "360p", etc.),
    // false = use Youtube's original notation ("hd720", "large", "medium", etc.).
    // For audio we always use the "XXXk" notation (e.g. "125k").
    var remap_quality = fg.getPref("media.YouTube.remap_stream_quality", false);
    var remap_type = fg.getPref("media.YouTube.remap_stream_type", false);
    var type_sort_order = remap_type ? Youtube.REMAP_TYPE_SORT_ORDER : Youtube.TYPE_SORT_ORDER;
    var audio_quality_granularity = fg.getPref("media.YouTube.audio_quality_granularity", 1) || 1;
    // FIXME: Ignore duplicate itags?
    var ignore_itags = [];
    // Map<string itag, string dimensions> fmt_list;
    var fmt_list = {};
    (data.fmt_list || "").split(",").forEach(function(o){
      var a = o.split("/");
      if (a.length < 2 || ! /^\d+x\d+$/.test(a[1])) { return; }
      fmt_list[a[0]] = a[1];
    });

    streams = streams.filter(function(s) {
      if (ignore_itags.indexOf(s.itag) !== -1) { return false; }

      // We're only interested in HTTP streams, no RTMP or something.
      if (!/^https?:\/\//.test(s.url)) { return false; }

      // For grouping by video in the media menu.
      // YouTube.
      if ((s["flashgot::video_id"] = data.video_id)) {
        s["flashgot::video_link"] = "https://www.youtube.com/watch?v=" + encodeURIComponent(s["flashgot::video_id"]);
      }
      // Google Drive/Videos.
      else if ((s["flashgot::video_id"] = data.docid)) {
        s["flashgot::video_link"] = "https://docs.google.com/file/d/" + encodeURIComponent(s["flashgot::video_id"]);
      }


      // Tidy the type: "video/3gpp;+codecs="mp4v.20.3,+mp4a.40.2"" -> "video/3gpp".
      s.type = s.type.split(";")[0];

      // Store unknown itags. Do this before any remapping (type and quality at the moment).
      // This is needed for sorting and for MediaSniffer to get the correct stream content
      // type (because DASH streams are served as "application/octet-stream").
      var is_known_itag = true;
      if (Youtube._map_itag(Youtube.STREAM_TYPE_MAP, s.itag, null) == null) {
        is_known_itag = false;
        fg.log("Unknown itag type: " + s.itag + ": type: '" + s.type + "'");
        s["flashgot::remap_type_hint"] = s.type.replace(/^video\/(?:x-)?/, "").replace(/3gpp$/, "3gp");
      }

      const SK_MEDIA_TYPE_VIDEO = 0; // "Normal" non-DASH video (has both audio and video tracks).
      const SK_MEDIA_TYPE_DASH_VIDEO = 1; // DASH video.
      const SK_MEDIA_TYPE_DASH_AUDIO = 2; // DASH audio.
      let sort_key = {"media": SK_MEDIA_TYPE_VIDEO, "quality": 0, "3d": 0, "container": 0};

      if (s["flashgot::yt_dash"] === "video") {
        sort_key["media"] = SK_MEDIA_TYPE_DASH_VIDEO;
      } else if (s["flashgot::yt_dash"] === "audio") {
        sort_key["media"] = SK_MEDIA_TYPE_DASH_AUDIO;
      }

      // Stream quality for sorting: height for video, bitrate for audio.
      let q = s["flashgot::yt_dash"] !== "audio"
        ? Youtube._map_itag(Youtube.STREAM_QUALITY_SORT_MAP, s.itag, 0)
        : Math.round(parseInt(s.quality) / audio_quality_granularity) * audio_quality_granularity;
      if ( ! q) {
        is_known_itag = false;
        fg.log("Unknown itag quality: " + s.itag + ": quality: '" + s.quality + "'");

        // Try whatever crap YouTube feeds us in fmt_list, adaptive_fmts,
        // and the DASH manifest: "WxH" for video (e.g. "1920x1080"),
        // "XXXk" for audio (e.g. "125k").
        // fmt_list and url_encoded_fmt_stream_map aren't always accurate,
        // e.g. they say "640x360"/"medium" for itag 59 (non-DASH mp4) while
        // the actual dimensions are 854x480 and 640x480. That's why we keep
        // our own actual quality (height) map in the preferences.
        if (/^\d+x(\d+)$/.test(fmt_list[s.itag] || s.quality)) {
          q = parseInt(RegExp.$1);
        }
      }
      if ( ! q) { q = 0; }
      // For "non-standard" heights: find a closest "standard" height.
      // YouTube does that for url_encoded_fmt_stream_map and fmt_list,
      // e.g. /watch?v=6pxRHBw-k8M - 1280x676 goes as "hd720" in
      // url_encoded_fmt_stream_map, as "1280x720" in fmt_list,
      // and as "1280x676" in adaptive_fmts and the DASH manifest.
      if (q && s["flashgot::yt_dash"] !== "audio") {
        // XXX: Make the list customizable via a user pref?
        let STD_RES = [144, 240, 360, 480, 520, 720, 1080, 1440,
          // http://en.wikipedia.org/wiki/High-definition_video
          1536, 2160, 2304 /*watch?v=Cx6eaVeYXOs*/, 2540, 3072, 4320];
        if (STD_RES.indexOf(q) === -1) {
          let min_diff = -1;
          let tmp_q = q;
          STD_RES.forEach(function(o){
            let diff = Math.abs(o - tmp_q);
            if (diff > 100) { return; }
            if (min_diff === -1 || min_diff > diff) {
              q = o;
              min_diff = diff;
            }
          });
        }
      }
      sort_key["quality"] = q;

      // Map video streams quality to the quality used in url_encoded_fmt_stream_map,
      // i.e. "1920x1080" -> "hd1080", "1280x720" -> "hd720", "640x360" -> "medium", etc.
      // Do this for both DASH and normal (non-DASH) video streams - see the "itag 59"
      // comment above.
      if (q && s["flashgot::yt_dash"] !== "audio") {
        switch (q) {
          case 520:
          case 480:
            s.quality = "large";
            break;
          case 360:
            s.quality = "medium";
            break;
          default:
            s.quality = q >= 720 ? "hd" + q : "small";
            break;
        }
      }

      if ( ! is_known_itag) {
        s["flashgot::map_quality_sort_key"] = q;
        Youtube.update_itag_map(s);
      }

      if (remap_type) { s.type = Youtube.remap_stream_type(s); }

      // "XXXp" for video (e.g. "720p"), "XXXk" for audio (e.g. "125k").
      if (remap_quality) { s.quality = q + (s["flashgot::yt_dash"] !== "audio" ? "p" : "k"); }
      // Mark 3D videos.
      // http://en.wikipedia.org/wiki/YouTube#Quality_and_codecs
      if ((s.itag >= 82 && s.itag <= 85) || (s.itag >= 100 && s.itag <= 102)) {
        s.quality += " (3D)";
        sort_key["3d"] = 1;
      }

      // Build the sort key.
      // Sort order: media type, quality desc, 3d, container.
      // Sort key is a uint32 in the following format:
      // octet:        3        2        1        0
      // bit:   76543210 76543210 76543210 76543210
      // type:        mm qqqqqqqq qqqqqqqq ffffcccc
      // Legend:
      //   m - media type - audio or video. See SK_MEDIA_TYPE_*.
      //   q - quality - height in pixels for video, bitrate in kbps for audio.
      //   f - 3D flag - 0 for non-3D, 1 for 3D.
      //   c - container type index from the container sort order.
      // Convert/clamp to uint16.
      sort_key["quality"] &= 0xffff;
      // "Inverse" the quality so that it's sorted in descending order.
      sort_key["quality"] = 0xffff - sort_key["quality"];
      sort_key["container"] = type_sort_order.indexOf(s.type) & 0x0f;
      s["flashgot::sort_key"] = (sort_key["media"] << 24)
        | (sort_key["quality"] << 8)
        | (sort_key["3d"] << 4)
        | sort_key["container"];

      // Decode the signature.
      try {
        var sig = signature_decoder.decode( {stream: s, video_info: data, swap: Youtube.decode_signature_swap} );
        if (sig) { s.url += "&signature=" + encodeURIComponent(sig); }
      } catch (x) {
        fg.log("Error calling YouTube.decode_signature_func: " + (x.message || x) + "\n" + x.stack);
        return false;
      }

      // Tidy the URL.
      if (fg.getPref("media.YouTube.stream_url.tidy", false)) {
        var extra_keep_params = fg.getPref("media.YouTube.stream_url.extra_keep_params", "")
          .split(/\s+/)
          // URL-decode.
          .map(unescape)
          // Ignore empty items.
          .filter(function(o){return o.length !== 0;});
        Youtube.tidy_stream_url(s, extra_keep_params);
      }

      // Add "ratebypass" (speed limit) and "cmbypass" (no idea)
      // if they're not part of the signature. There's also
      // the "shardbypass" parameter (no idea either).
      // Also, VLC player on Windows doesn't support HTTPS
      // ("TLS client plugin not available"), so we need to
      // fall back to HTTP if possible.
      var idx = s.url.indexOf("?");
      if (idx !== -1 && idx + 1 !== s.url.length) {
        var qs = Youtube.parse(s.url.substr(idx + 1));
        var sparams = (qs.sparams || "").split(",");
        if (sparams.indexOf("ratebypass") === -1) { qs.ratebypass = "yes"; }
        if (sparams.indexOf("cmbypass") === -1) { qs.cmbypass = "yes"; }
        s.url = s.url.substr(0, idx + 1)
          + Object.keys(qs)
            .map(function(p){return encodeURIComponent(p) + "=" + encodeURIComponent(qs[p] || "")})
            .join("&");
        // VLC player HTTPS workaround.
        if (fg.getPref("media.YouTube.prefer_http", false)
          && (sparams.indexOf("requiressl") === -1 || qs.requiressl !== "yes"))
        {
          s.url = s.url.replace(/^https:/, "http:");
        }
      }

      ignore_itags.push(s.itag);
      return true;
    });
    signature_decoder.dispose();
    if (!streams.length) { return false; }
    callback( {title: data_title, streams: streams} );
    return true;
  }, // process_video_info()

  get_dashmpd_streams: function(xml, data, streams) {
    let nl = xml.getElementsByTagName("AdaptationSet");
    [].forEach.call(nl, function(n){
      let type = n.getAttribute("mimeType");
      if ( ! /^(audio|video)\//.test(type)) { return; }
      let is_audio = "audio" == RegExp.$1;
      let nl = n.getElementsByTagName("Representation");
      [].forEach.call(nl, function(n){
        let itag = n.getAttribute("id");
        let quality = is_audio ? Math.round(n.getAttribute("bandwidth") / 1024) + "k"
            : n.getAttribute("width") + "x" + n.getAttribute("height");
        let elm_url = n.getElementsByTagName("BaseURL")[0];
        if ( ! elm_url) { return; }
        let url = (elm_url.firstChild || {}).nodeValue;
        if ( ! url) { return; }
        if ( ! itag && /[?&]itag=([^&#]+)/.test(url)) {
          itag = decodeURIComponent(RegExp.$1);
        }
        if ( ! itag) { return; }
        let s = {
          itag: itag,
          url: url,
          type: type,
          quality: quality,
          "flashgot::yt_dash": is_audio ? "audio" : "video"
        };
        streams.push(s);
      });
    });
  },

  TYPE_SORT_ORDER: [],
  REMAP_TYPE_SORT_ORDER: [],

  // Map<String name, Array<string> itags> STREAM_REMAP_TYPE_MAP;
  STREAM_REMAP_TYPE_MAP: {},
  // Map<String name, Array<string> itags> STREAM_TYPE_MAP;
  STREAM_TYPE_MAP: {},
  // Map<String name, Array<string> itags> STREAM_QUALITY_SORT_MAP;
  STREAM_QUALITY_SORT_MAP: {},
  remap_stream_type: function(stream) {
    return this._map_itag(this.STREAM_REMAP_TYPE_MAP, stream.itag, stream.type);
  },
  _map_itag: function(map, itag, defaultValue) {
    for (var p in map) {
      var o = map[p];
      if (o.itags.indexOf(itag) !== -1) {
        return o.name;
      }
    }
    return defaultValue;
  },
  get_stream_content_type: function(url) {
    if ( ! this.is_stream_url(url) || ! /[?&]itag=([^&]+)/.test(url)) { return null; }
    return this._map_itag(this.STREAM_TYPE_MAP, decodeURIComponent(RegExp.$1), null)
      || (/[?&]mime=([^&]+)/.test(url) && decodeURIComponent(RegExp.$1))
      || null;
  },

  update_itag_map: function(stream) {
    var a_t = this.update_itag_map_branch("media.YouTube.itag_map.type.", stream.itag, stream.type);
    // Try to find and update the corresponding remapping branch.
    var r_t = this.update_itag_remap_branch("media.YouTube.itag_remap.type.", stream.itag, a_t, stream["flashgot::remap_type_hint"]);
    if (r_t) { fg.log("Unknown itag remap: " + stream.itag + ": type: '" + stream.type + "' -> '" + r_t + "'"); }
    // Don't care about quality information for audio streams.
    if (stream["flashgot::yt_dash"] === "audio") { return; }
    if (stream["flashgot::map_quality_sort_key"]) {
      this.update_itag_map_branch("media.YouTube.itag_map.quality_sort_key.", stream.itag, stream["flashgot::map_quality_sort_key"]);
    }
  },

  // @return Array<string> the previous value of the ".itags" branch
  // if the branch was updated, null otherwise (e.g. itag already exists).
  update_itag_map_branch: function(branch, itag, value) {
    try {
      value = String(value).replace(/^\s+|\s+$/g, "");
      if ( ! value.length) { return null; }
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService)
        .getBranch("flashgot." + branch);
      var a = pref.getChildList("");
      for (var i = 0, len = a.length; i !== len; ++i) {
        var c = a[i];
        if (c.indexOf(".") !== -1) { continue; }
        try {
          var name = pref.getCharPref(c);
          if (name != value) { continue; }
          var values_branch_name = c + ".itags";
          var values = this.parsePrefStringList(pref.getCharPref(values_branch_name));
          if (values.indexOf(itag) !== -1) { return null; }
          pref.setCharPref(values_branch_name, values.concat(itag).sort(function(l,r){return l-r;}).join(","));
          return values;
        }
        catch (x) {
          fg.log("update_itag_map_branch: c='" + c + "': " + (x.message || x) + "\n" + (x.stack || new Error().stack));
        }
      }

      // Branch doesn't exist - create a new one.
      branch = value.replace(/\./g, "_");
      pref.setCharPref(branch, value);
      pref.setCharPref(branch + ".itags", String(itag));
    }
    catch (x) {
      fg.log("update_itag_map_branch: " + (x.message || x) + "\n" + (x.stack || new Error().stack));
    }
    return null;
  },

  update_itag_remap_branch: function(branch, itag, itags, remap_hint) {
    try {
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService)
        .getBranch("flashgot." + branch);

      if (remap_hint) {
        var name_branch_name = remap_hint.replace(/\./g, "_");
        var values_branch_name = name_branch_name + ".itags";
        var values;
        if (pref.getPrefType(values_branch_name) != 0 /*PREF_INVALID*/) {
          values = this.parsePrefStringList(pref.getCharPref(values_branch_name));
          if (values.indexOf(itag) !== -1) { return; }
        } else {
          values = [];
        }
        values.push(itag);
        pref.setCharPref(name_branch_name, remap_hint);
        pref.setCharPref(values_branch_name, values.sort(function(l,r){return l-r;}).join(","));
        return remap_hint;
      }

      // Find the first ".itags" branch that contains the entire |itags| array
      // and put |itag| there.
      if ( ! itags || ! itags.length) { return; }
      var a = pref.getChildList("");
      var remap_hint_values;
      for (var i = 0, len = a.length; i !== len; ++i) {
        var c = a[i];
        if (c.indexOf(".") !== -1) { continue; }
        try {
          var name = pref.getCharPref(c);
          var values_branch_name = c + ".itags";
          var values = this.parsePrefStringList(pref.getCharPref(values_branch_name));
          if (values.indexOf(itag) !== -1) { return; }
          if ( ! remap_hint_values && name == remap_hint) { remap_hint_values = values; }
          if (values.length < itags.length) { continue; }
          var itags_cpy = itags.concat();
          while (itags_cpy.length) {
            if (values.indexOf(itags_cpy[0]) === -1) { break; }
            itags_cpy.shift();
          }
          if (itags_cpy.length) { continue; }
          values.push(itag);
          pref.setCharPref(values_branch_name, values.sort(function(l,r){return l-r;}).join(","));
          return name;
        }
        catch (x) {
          fg.log("update_itag_remap_branch: c='" + c + "': " + (x.message || x) + "\n" + (x.stack || new Error().stack));
        }
      }
    }
    catch (x) {
      fg.log("update_itag_remap_branch: " + (x.message || x) + "\n" + (x.stack || new Error().stack));
    }
  },


  // Removes junk parameters (like "fexp") from the stream URL.
  // We keep the following parameters:
  // (*) those listed in the "sparams" parameter
  // (*) "sparams"
  // (*) "signature"
  // (*) "key"
  // (*) "id" (internal? (as in private/non-public) video ID)
  // (*) "itag" (stream "ID" - container type and video quality)
  // (*) "mime" (stream content type, e.g. "video/mp4")
  // (*) those passed in the |extra_keep_params| argument.
  // (*) anything that ends with "bypass" and has the value of "yes".
  tidy_stream_url: function (stream, extra_keep_params /*= null*/ ) {
    if (!extra_keep_params) { extra_keep_params = []; }
    var url = stream.url;
    if (!url) { return; }
    var qs_idx = url.indexOf("?");
    if (qs_idx === -1 || qs_idx + 1 === url.length) { return; }
    var qs = Youtube.parse(url.substr(qs_idx + 1));
    var sparams = qs["sparams"];
    if (!sparams) { return; }
    sparams = sparams.split(",");
    extra_keep_params.push("sparams", "signature", "key", "id", "itag", "mime");
    extra_keep_params.forEach(function(p){if (sparams.indexOf(p) === -1) sparams.push(p);});
    var new_qs = [];
    for (var p in qs) {
      if (sparams.indexOf(p) !== -1 || (/.+bypass$/.test(p) && qs[p] === "yes")) {
        new_qs.push(encodeURIComponent(p) + "=" + encodeURIComponent(qs[p] || ""));
      }
    }
    stream.url = url.substr(0, qs_idx + 1) + new_qs.join("&");
  },

  // For YouTube, we can't rely on simple URL comparison because
  // the query strings of our parsed streams and the ones built by
  // the player can (and most likely, will) differ.
  stream_url_equals: function (url1, url2) {
    if (!this.is_stream_url(url1) || !this.is_stream_url(url2)) { return false; }

    // The |id| parameter is something like the internal video ID:
    // it's different for two different videos (those with different
    // "public" video IDs - /watch?v=VIDEO_ID), and it's the same for
    // all the streams of the same video.
    // They started to encode the "id" parameter, so you can get
    // different values for the same streams from different embed
    // iframes for the same video.
    var id1 = /[?&]id=([^&]+)/.test(url1) ? RegExp.$1 : "flashgot-id-1";
    var id2 = /[?&]id=([^&]+)/.test(url2) ? RegExp.$1 : "flashgot-id-2";
    if (id1 !== id2) { return false; }

    // The only thing that allows us to identify a stream is the |itag|
    // parameter, which is a combination of the container type (MP4,
    // FLV, etc.) and the quality (1080p, 1080p 3D, 720p, etc.).
    var itag1 = /[?&]itag=([^&]+)/.test(url1) ? RegExp.$1 : "flashgot-itag-1";
    var itag2 = /[?&]itag=([^&]+)/.test(url2) ? RegExp.$1 : "flashgot-itag-2";
    if (itag1 !== itag2) { return false; }

    // Different seek positions are considered different streams (in case
    // the user wants to save the stream from a particular position).
    var begin1 = /[?&]begin=([^&]+)/.test(url1) ? RegExp.$1 : "0";
    var begin2 = /[?&]begin=([^&]+)/.test(url2) ? RegExp.$1 : "0";
    return begin1 === begin2;
  },

  is_stream_url: function (url) {
    return /^https?:\/\/([^\/]+)\/videoplayback\?/.test(url)
      && /\.(?:youtube|googlevideo|google)\.com(?::[0-9]+)?$/.test(RegExp.$1);
  },

  decode_signature: function (params) {
    /* Not encoded. */
    return params.stream.sig || "";
  },
  decode_signature_swap: function (a, idx) {
    var tmp = a[0];
    a[0] = a[idx % a.length];
    a[idx] = tmp;
    return a;
  },

  create_signature_decoder: function () {
    var s = fg.getPref("media.YouTube.decode_signature_func", "");
    if (!s) {
      return new SignatureDecoder(Youtube.decode_signature);
    }
    // Fail fast: try to compile right now to check the code for
    // syntax errors, so that we don't do all that heavy stuff for
    // sandbox initialization only to fail later in evalInSandbox()
    // and have an incorrect error message saying "error _calling_
    // the function" while actually we failed to compile it.
    var func = null;
    try {
      func = new Function("params", s);
    } catch (x) {
      throw new Error("Error compiling YouTube.decode_signature_func: " + (x.message || x));
    }
    if ( ! fg.getPref("media.YouTube.decode_signature_func.sandbox", true)) {
      return new SignatureDecoder(func);
    }
    // Wrap the code into a function invocation because we promised
    // to call it as a function with one parameter.
    s = "(function(params){\n" + s + "\n})(params);";
    return new SandboxedSignatureDecoder(s)
      // Sandboxing stuff is not supported - fall back to non-sandboxed.
      || new SignatureDecoder(func);
  },


  refresh_signature_func: function (w, callback /*= null*/, force /*= false*/) {
    return SDASniffer.sniff(w, callback, force);
  },


  readItagMap: function (branch, map) {
    try {
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService)
        .getBranch("flashgot." + branch);
      pref.addObserver("", new ItagMapObserver(pref, map), false);
      var a = pref.getChildList("");
      for (var i = 0, len = a.length; i !== len; ++i) {
        var c = a[i];
        if (c.indexOf(".") !== -1) { continue; }
        try {
          var name = pref.getCharPref(c);
          var value = this.parsePrefStringList(pref.getCharPref(c + ".itags"));
          map[c] = {name: name, itags: value};
        }
        catch (x) {
          fg.log("readItagMap: c='" + c + "': " + (x.message || x) + "\n" + (x.stack || new Error().stack));
        }
      }
    }
    catch (x) {
      fg.log("readItagMap: " + (x.message || x) + "\n" + (x.stack || new Error().stack));
    }
  },

  parsePrefStringList: function(str) {
    return str.split(/\s*,\s*/).filter(function(o){return o.length;});
  },

  readSortOrder: function (branch, list) {
    try {
      var pref = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService)
        .getBranch("flashgot." + branch);
      pref.addObserver("", new SortOrderObserver(pref, list), false);

      var a = this.parsePrefStringList(fg.getPref(branch, ""));
      for (var i = 0, len = a.length; i !== len; ++i) {
        list.push(a[i]);
      }
    }
    catch (x) {
      fg.log("readSortOrder: " + (x.message || x) + "\n" + (x.stack || new Error().stack));
    }
  }

}; // Youtube



function ItagMapObserver(branch, map) {
  // We have to hold a reference to the observed nsIPrefBranch,
  // otherwise we won't be called.
  this.branch = branch;
  this.map = map;
}
ItagMapObserver.prototype = {
  observe: function(branch, topic, name) {
    try {
      if (topic !== "nsPref:changed" /*NS_PREFBRANCH_PREFCHANGE_TOPIC_ID*/) { return; }
      var path = name.split(".");
      // We're watching "YouTube.itag_map.type." and "YouTube.itag_map.quality.",
      // so their possible valid children are "XXX" and "XXX.itags", e.g.
      // "media.YouTube.itag_map.type.360p" and "media.YouTube.itag_map.type.360p.itags".
      if (path.length > 2) { return; }
      if (path.length === 2 && path[1] !== "itags") { return; }

      var item = this.map[path[0]];
      if ( ! item) {
        item = {name: "", itags: []};
      }
      if (branch.getPrefType(path[0]) !== 0 /*PREF_INVALID*/) {
        item.name = branch.getCharPref(path[0]);
      } else {
        delete this.map[path[0]];
        return;
      }
      if (path.length > 1) {
        if (branch.getPrefType(name) !== 0 /*PREF_INVALID*/) {
          item.itags = Youtube.parsePrefStringList(branch.getCharPref(name));
        } else {
          delete this.map[path[0]];
          return;
        }
      }
      if (item.name.length === 0 || item.itags.length === 0) {
        delete this.map[path[0]];
      } else {
        this.map[path[0]] = item;
      }
    }
    catch (x) {
      fg.log("ItagMapObserver: " + (x.message || x));
    }
  }
};

function SortOrderObserver(branch, list) {
  this.branch = branch;
  this.list = list;
}
SortOrderObserver.prototype = {
  observe: function(branch, topic, name) {
    try {
      if (topic !== "nsPref:changed" /*NS_PREFBRANCH_PREFCHANGE_TOPIC_ID*/) { return; }
      if (name.length !== 0) { return; }
      var a = Youtube.parsePrefStringList(branch.getCharPref(name));
      var list = this.list;
      list.length = 0;
      for (var i = 0, len = a.length; i !== len; ++i) {
        list.push(a[i]);
      }
    }
    catch (x) {
      fg.log("SortOrderObserver: " + (x.message || x));
    }
  }
};



// Drop deprecated preferences.
void function(){
  try {
    var pref = Components.classes["@mozilla.org/preferences-service;1"]
      .getService(Components.interfaces.nsIPrefService)
      .getBranch("flashgot.media.YouTube.");
    pref.deleteBranch("itag_map.quality.");
    pref.deleteBranch("itag_remap.quality.");
    pref.deleteBranch("quality_sort_order");
    pref.deleteBranch("remap_quality_sort_order");
  } catch (ignore) {}
}();

Youtube.readItagMap("media.YouTube.itag_map.type.", Youtube.STREAM_TYPE_MAP);
Youtube.readItagMap("media.YouTube.itag_map.quality_sort_key.", Youtube.STREAM_QUALITY_SORT_MAP);
Youtube.readItagMap("media.YouTube.itag_remap.type.", Youtube.STREAM_REMAP_TYPE_MAP);
Youtube.readSortOrder("media.YouTube.type_sort_order", Youtube.TYPE_SORT_ORDER);
Youtube.readSortOrder("media.YouTube.remap_type_sort_order", Youtube.REMAP_TYPE_SORT_ORDER);



///////////////////////////////////////////////////////////////////////////////
// Private part.

// interface ISignatureDecoder {
//   string decode(Params params);
//   void dispose();
// }
// class Params {
//   Map<string, string> stream;
//   Map<string, string> video_info;
//   Function swap; //Array swap(Array, int);
// }
//
// class SignatureDecoder implements ISignatureDecoder {
//   SignatureDecoder(Function func);
// }
function SignatureDecoder(func) {
  this.func = func;
}

SignatureDecoder.prototype = {
  decode: function(params) { return this.func(params); },
  dispose: function() { this.func = null; }
};


// class SandboxedSignatureDecoder implements ISignatureDecoder {
//   SandboxedSignatureDecoder(String code_str);
// }
function SandboxedSignatureDecoder(code_str) {
  this.code_str = code_str;

  this.sandbox = this.create_sandbox();
  if ( ! this.sandbox) { return null; }

} // SandboxedSignatureDecoder()


SandboxedSignatureDecoder.prototype = {
  // https://developer.mozilla.org/en-US/docs/Security_check_basics:
  // The null principal (whose contract ID is @mozilla.org/nullprincipal;1)
  // fails almost all security checks. It has no privileges and can't be
  // accessed by anything but itself and chrome. They aren't same-origin
  // with anything but themselves.
  SANDBOX_PRINCIPAL: Components.classes["@mozilla.org/nullprincipal;1"]
    .createInstance(Components.interfaces.nsIPrincipal),

  SANDBOX_OPTIONS: {wantComponents: false, wantXHRConstructor: false},

  create_sandbox: function() {
    if (typeof Components.utils.Sandbox !== "function") {
      return null;
    }
    var s_gecko_ver = Components.classes["@mozilla.org/xre/app-info;1"]
      .getService(Components.interfaces.nsIXULAppInfo)
      .platformVersion;
    var gecko_ver = parseInt(s_gecko_ver);
    // NaN, Infinity.
    if ( ! isFinite(gecko_ver)) {
      throw new Error("Failed to parse Gecko version: '" + s_gecko_ver + "'.");
    }
    if (gecko_ver >= 2) {
      return new Components.utils.Sandbox(this.SANDBOX_PRINCIPAL, this.SANDBOX_OPTIONS);
    }
    var opts = this.SANDBOX_OPTIONS;
    var proto = opts.hasOwnProperty("sandboxPrototype") ? opts.sandboxPrototype : {} /*FIXME: null?*/;
    var wantXrays = opts.hasOwnProperty("wantXrays") ? opts.wantXrays : true;
    return new Components.utils.Sandbox(this.SANDBOX_PRINCIPAL, proto, wantXrays);
  },

  decode: function (params) {
    var rc = Components.utils.evalInSandbox(
      "var params = " + params.toSource() + ";\n" + 
      this.code_str,
      this.sandbox);
    
    // No fancy return values - we expect a primitive string value.
    // We don't silently return something that could pass for a signature.
    // Instead, we throw - to inform the user that their decode_signature_func
    // function is broken (anyone can make a typo) or malicious.
    //
    // It's OK to pass uncaught exceptions as-is because even if they have
    // getters for properties like "message", those will be executed in the
    // context of the sandbox (i.e. the global |this| will point to the sandbox),
    // which is useless for malicious code anyway.
    // Here's what am I talking about - somewhere in the sandboxed code:
    //   var x = new Error();
    //   x.__defineGetter__("message", function(){alert("pwned");});
    //   throw x;
    //   or:
    //   var x = { message: { valueOf: function(){alert("pwned");}, toString: function(){alert("pwned");} } };
    //   throw x;
    // We could catch the exceptions here, manually sanitize them and rethrow
    // if they're safe to use in our chrome code, but I just don't see the point
    // in doing so because if there's a bug in the security manager, then our
    // manual sanitization will just conceal it.
    if (typeof (rc) === "string") { return rc; }
    // Nulls are kinda OK.
    if (rc === null) { return ""; }
    // A forgotten return or outdated code that returns nonexistent stream
    // properties? Worth a warning in either case.
    if (rc === undefined) {
      fg.log("WARNING: YouTube.decode_signature_func returned undefined.");
      return "";
    }
    throw new Error("Invalid return value type: expected string, got " + typeof (rc));
  }, // decode()

  dispose: function () {
    if (!this.sandbox) { return; }
    if (typeof Components.utils.nukeSandbox === "function") {
      Components.utils.nukeSandbox(this.sandbox);
    }
    this.sandbox = null;
  }
}; // SandboxedSignatureDecoder.prototype



// Signature decoding algorithm (SDA) sniffer.
var SDASniffer = {
  // We don't want "over 9000" workers doing the same thing when one
  // is enough (can happen if we're restoring a session with several
  // YouTube tabs/windows).
  // static boolean working = false;
  // static Array<Function> callbacks = [];
  working: false,
  callbacks: [],

  sniff: function (w, callback /*= null*/, force /*= false*/) {
    if (typeof(callback) !== "function") { callback = null; }

    if (this.working) {
      if (callback) { this.callbacks.push(callback); }
      return true;
    }

    // Get the SWF player URL.
    w = w.wrappedJSObject;
    var swf_url;
    var o;
    // ytplayer.config.url
    if (w && (o = w.ytplayer) && (o = o.config)) {
      swf_url = o.url;
    }
    // yt.config_["PLAYER_CONFIG"].url
    else if (w && (o = w.yt) && (o = o.config_) && (o = o.PLAYER_CONFIG)) {
      swf_url = o.url;
    }
    if (!swf_url) { return false; }
    fg.log("SWF URL: " + swf_url);

    // Automatic update frequency is limited so that we waste less traffic
    // and CPU cycles in case YoutubeSwf code is outdated.
    if ( ! force) {
      var now = Math.floor(Date.now() / 1000);
      var min_int = fg.getPref("media.YouTube.decode_signature_func.auto.min_interval", 60);
      var last_update = fg.getPref("media.YouTube.decode_signature_func.auto.last_update_time", 0);
      if (min_int !== 0 && now - last_update < min_int) {
        if ( ! fg.getPref("media.YouTube.decode_signature_func.auto.last_update_ok")) {
          return false;
        }
        // We promised to be async, so we can't call back _before_ we return,
        // hence setTimeout.
        w.setTimeout(function(){
          try {
            callback();
          } catch (x) {
            fg.log("Callback error: " + (x.message || x) + "\n" + x.stack);
          }
        }, 1);
        return true;
      }
      fg.setPref("media.YouTube.decode_signature_func.auto.last_update_time", now);
    }

    var st, ft;
    var stream_ctx = {
      file: swf_url, //.split("/").pop().replace(/\?.*$/, "").replace(/#.*$/, ""),
      bytes: "",
      contentLength: -1,
      bstream: null
    };
    var stream_listener = {
      onDataAvailable: function (req, ctx, stream, offset, count) {
        stream_ctx.bstream.setInputStream(stream);
        stream_ctx.bytes += stream_ctx.bstream.readBytes(count);
      },
      onStartRequest: function (req /*, ctx*/) {
        var channel = req.QueryInterface(Components.interfaces.nsIChannel);
        if (!((channel instanceof Components.interfaces.nsIHttpChannel)
          && Components.isSuccessCode(channel.status)
          && channel.responseStatus === 200))
        {
          throw new Error("cancel"); //req.cancel(NS_BINDING_ABORTED);
        }
        stream_ctx.contentLength = channel.contentLength || -1;
        fg.log("SWF content length: " + stream_ctx.contentLength);
        stream_ctx.bstream = Components.classes["@mozilla.org/binaryinputstream;1"]
          .createInstance(Components.interfaces.nsIBinaryInputStream);
        st = Date.now();
      },
      onStopRequest: function (req, ctx, status) {
        ft = Date.now();
        stream_ctx.bstream = null;
        // SDASniffer::sniff0 is async, so we can't simply do if (SDASniffer.working) {clean up}.
        var cleanup = true;
        if (Components.isSuccessCode(status)) {
          fg.log("SWF downloaded in " + (ft - st) + " ms, size: " + stream_ctx.bytes.length);
          if (stream_ctx.contentLength === -1 || stream_ctx.bytes.length === stream_ctx.contentLength) {
            SDASniffer.sniff0(stream_ctx, callback);
            cleanup = false;
          }
          else {
            fg.log("SWF content length mismatch: expected " + stream_ctx.contentLength + ", got " + stream_ctx.bytes.length);
          }
        }
        else {
          fg.log("Failed to download the SWF: status=" + status);
        }
        stream_ctx = null;
        if (cleanup) {
          SDASniffer.working = false;
          SDASniffer.callbacks = [];
        }
      }
    }; // stream_listener
    Components.classes["@mozilla.org/network/io-service;1"]
      .getService(Components.interfaces.nsIIOService)
      .newChannel(swf_url, null, null)
      .asyncOpen(stream_listener, null);

    this.working = true;
    if (callback) { this.callbacks.push(callback); }
    fg.setPref("media.YouTube.decode_signature_func.auto.last_update_ok", false);
    return true;
  },


  sniff0: function (ctx, callback) {
    // Using a worker instead of a direct call resolves the problem
    // with GUI freezing due to severe performance degradation: 100 ms
    // vs 2400 ms for zip_inflate(), 100 ms vs 800 ms for swf_parse().
    // See bug 911570 (https://bugzilla.mozilla.org/show_bug.cgi?id=911570),
    // or 776798, or 907201, or whatever is causing it.
    var worker = new SDAWorker( {bytes: ctx.bytes, file: ctx.file} );
    ctx.bytes = null;

    worker.onfinish = function(rc) {
      SDASniffer.working = false;
      var callbacks = SDASniffer.callbacks;
      SDASniffer.callbacks = [];

      if (typeof(rc) === "string") {
        fg.log("Error refreshing signature function: " + rc);
        return;
      }

      if ( ! rc) { return; }
      fg.setPref("media.YouTube.decode_signature_func.auto.last_update_ok", true);

      if (rc.timestamp !== fg.getPref("media.YouTube.decode_signature_func.timestamp")) {
        fg.log("New timestamp: " + rc.timestamp);
        fg.setPref("media.YouTube.decode_signature_func.timestamp", rc.timestamp);
      }

      if (rc.func_text !== fg.getPref("media.YouTube.decode_signature_func")) {
        fg.log("New signature function:\n" + rc.func_text);
        fg.setPref("media.YouTube.decode_signature_func", rc.func_text);
        callbacks.forEach(function(f){
          try {
            f();
          } catch (x) {
            fg.log("Callback error: " + (x.message || x) + "\n" + x.stack);
          }
        });
      }
    };

    try {
      worker.start();
    } catch (x) {
      worker.onfinish("Error starting the worker: " + (x.message || x) + "\n" + x.stack);
    }
  }
}; // SDASniffer



// class SDAWorker;
function SDAWorker(ctx) {
  this.ctx = ctx;
  this.worker = null;
  this.fired_onfinish = false;
}

SDAWorker.prototype = {
  // public
  start: function() {
    var worker = this.worker = new Worker("YoutubeSwf.js");
    worker["SDAWorker::this"] = this;
    worker.onmessage = this.worker_onmessage;
    worker.onerror = this.worker_onerror;
    worker.postMessage(this.ctx);
    this.ctx = null;
  },

  // Completion event handler, implemented by the caller.
  // void onfinish(Object data);
  // @param data - the result of the decoding, one of:
  //   1) a primitive string value (typeof data === "string") - there was
  //      an uncaught exception in the worker, and |data| is the error message.
  //   2) Object - struct { string func_text; int timestamp; } - the result
  //      of the decoding. Can be null/undefined (data == null covers both)
  //      if the signature function could not be decoded.
  onfinish: function(){},


  // private
  fire_onfinish: function(data) {
    this.fired_onfinish = true;
    try {
      this.onfinish(data);
    } catch (x) {
      fg.log("Error in onfinish: " + (x.message || x) + "\n" + x.stack);
    }
  },

  worker_onmessage: function(evt) {
    var This = this["SDAWorker::this"];
    // struct msg { string type; Object data; };
    var msg = evt.data;
    if (msg == null) {
      fg.log("SDAWorker: Invalid message: null or undefined: " + msg);
      This.finish();
      return;
    }
    if (typeof(msg) !== "object") {
      fg.log("SDAWorker: Invalid message: expected [object], got [" + typeof(msg) + "]: " + msg);
      This.finish();
      return;
    }
    switch (msg.type) {
      case "done":
        This.finish();
        return;
      case "log":
        fg.log(msg.data);
        return;
      case "result":
        This.fire_onfinish(msg.data);
        return;
    }
    fg.log("SDAWorker: Invalid message type: '" + msg.type + "'");
    This.finish();
  },

  worker_onerror: function(evt) {
    var This = this["SDAWorker::this"];
    This.fire_onfinish("Uncaught exception in worker: " + evt.message);
    This.finish();
  },

  finish: function() {
    if ( ! this.fired_onfinish) {
      this.fire_onfinish(null);
    }
    try {
      this.worker.terminate();
      this.worker["SDAWorker::this"]
        = this.worker.onmessage
        = this.worker.onerror
        = null;
      this.worker = null;
    } catch (x) {
      fg.log("Error terminating the worker: " + (x.message || x) + "\n" + x.stack);
    }
  }
}; // SDAWorker.prototype


return Youtube;
}(); // Youtube
