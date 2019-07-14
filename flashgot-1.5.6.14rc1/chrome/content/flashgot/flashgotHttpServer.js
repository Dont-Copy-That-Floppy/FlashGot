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

/* Data Swap HTTP server */

FlashGotHttpServer=function(fgService) {
  this.fgService=fgService;
  this.isDown=true;
  this.serverSocket=Components.classes['@mozilla.org/network/server-socket;1'
    ].createInstance(Components.interfaces.nsIServerSocket);
  this.serverSocket.init(-1,true,-1);
  this.isDown=false;
  this.serverSocket.asyncListen(this);
  this.tmpDir=this.fgService.tmpDir.clone();
  this.tmpDir.append("httpserv");
  this.logEnabled=fgService.getPref("LeechGet.httpLog",false);
  this.log("Listening");
}

FlashGotHttpServer.prototype={
  documents: []
,
  log: function(msg){
    if(this.logEnabled && this.fgService.logEnabled) {
      try {
        if(!this.logStream) {
          const logFile=this.tmpDir.clone();
          logFile.append("server.log");
          logFile.createUnique(0, parseInt("0600", 8));
          const logStream=Components.classes["@mozilla.org/network/file-output-stream;1"
            ].createInstance(Components.interfaces.nsIFileOutputStream );
          logStream.init(logFile, 0x02 | 0x10, B8('600'), 0 );
          this.logStream=logStream;
        }
        msg="HttpServer:"+this.serverSocket.port+" - "+msg+"\n";
        this.logStream.write(msg,msg.length);
        this.logStream.flush();
      } catch(ex) {}
    }
  }
,
  onSocketAccepted: function(ss,transport) {
    this.log("Accepted request from "
      +transport.host+":"+transport.port);
     try {
        new FlashGotHttpHandler(this,transport);
     } catch(ex) {
       this.log(ex.message);
     }
  }
,
  onStopListening: function(ss,status) {
    this.isDown=true;
    if(this.logStream) {
      this.log("Stopped, status "+status);
    }
  }
,
  randomName: function(len) {
    if(!len) len=8;
    var name="";
    for(var j=len; j-->0;) {
      name+=String.fromCharCode(65+(Math.round(Math.random()*25)));
    }
    return name;
  }
,
  addDoc: function(docSource,docType) {
    if (typeof(docType) == "undefined") docType="html";
    var file=this.tmpDir.clone();
    file.append(this.randomName() + "." + docType);
    file.createUnique(0, B8('600'));
    IO.writeFile(file, docSource);
    const name=file.leafName;
    this.documents.push(name);
    return "http://localhost:" + this.serverSocket.port + "/" + name;
  }
,
  getDoc: function(name) {
    const docs=this.documents;
    for(var j=docs.length; j-->0;) {
      if(docs[j]==name) break;
    }
    if(j<0) return null;
    var file=this.tmpDir.clone();
    file.append(name);
    return file.exists() ? IO.readFile(file) : null;
  }
,  
  shutdown: function() {
    try {
      this.log("Shutting down");
      if(this.logStream) {
        this.logStream.close();
        this.logStream=null;
      }
      this.serverSocket.close();
    } catch(ex) {}
  }
}

function FlashGotHttpHandler(server,transport) {
  this.server=server;
  this.inputBuffer="";
  this.transport=transport;
  this.asyncStream=transport.openInputStream(0,0,0).QueryInterface(
    Components.interfaces.nsIAsyncInputStream);
  this.log("Waiting for request data...");
  
  const nsIThread=Components.interfaces.nsIThread;
  var thread=Components.classes['@mozilla.org/thread;1'].createInstance(nsIThread);
  thread.init(this, 0,  nsIThread.PRIORITY_NORMAL, nsIThread.SCOPE_GLOBAL,nsIThread.STATE_JOINABLE);
  this.log("Thread started");
}

FlashGotHttpHandler.prototype = {
  log: function(msg) {
    this.server.log(this.transport.host+":"+this.transport.port+" - "+msg);
  }
,
  run: function() {
     this.log("I'm in thread");
     this.asyncStream.asyncWait(this,0,0,null);
     this.log("Asyncwait issued");
  }
,  
  onInputStreamReady: function(asyncStream) {
    const bytesCount=asyncStream.available();
    this.log("Input stream ready, available bytes: "+bytesCount);
    if(bytesCount) {
      const inStream=Components.classes['@mozilla.org/scriptableinputstream;1'].createInstance(
        Components.interfaces.nsIScriptableInputStream);
      inStream.init(asyncStream);
      var chunk=inStream.read(inStream.available());
      this.log("Received data chunk "+chunk);
      var buffer=this.inputBuffer.concat(chunk);
      var eor=chunk.length==0?buffer.length:buffer.search("\r?\n\r?\n");
      this.log("EOR: "+eor);
      if(eor>-1) {
        var request=buffer.substring(0,eor);
        this.inputBuffer="";
        this.handleRequest(request);
        this.close();
      } else {
        this.inputBuffer=buffer;
        this.run();
      }
    } else {
      this.close();
    }
  }
,
  close: function() {
    this.asyncStream.close();
  }
,
  buildResponse: function(body,status,contentType) {
    if(!contentType) contentType="text/html";
    if(!status) {
      status="200 OK";
    } else {
      body="<h1>"+status+"</h1><pre>"
        +body
        +"</pre><h5>FlashGot Http Server v. 0.1</h5>"
    }
    return "HTTP/1.1 "+status+"\r\nContent-type: "+contentType+"\r\n\r\n"+body;
  }
,
  handleRequest: function(request) {
    var response;
    var match;
    this.log("Handling request\n"+request);
    try {
      if(!(match=request.match(/^GET \/([^\s]*)/))) {
        response=this.buildResponse(request,"400 Bad Request"); 
      } else {
        var doc=this.server.getDoc(match[1]);
        
        if(doc==null) {
          response=this.buildResponse(request,"404 Not Found");
        } else {
          response=this.buildResponse(doc);
        }
      }
    } catch(ex) {
      response=this.buildResponse(ex.message+"\n"+request,"500 Server error");
    }
    var out=this.transport.openOutputStream(1,0,0);
    out.write(response,response.length);
    out.close();
    this.log("Sent response\n"+response);
  } 
}

