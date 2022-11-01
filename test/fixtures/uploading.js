const cluster = require("cluster");
const http = require("http");
const fs = require("fs");
const { Server } = require("socket.io");
const ioc = require("socket.io-client");
const { setupMaster, setupWorker } = require("../..");

if (cluster.isWorker) {
  const httpServer = http.createServer((req, res) => {
    req.once("end", () =>
      res.end("finish", () => console.log("sent response"))
    );
    req.on("data", (data) => {
      data.length;
    });
  });
  const io = new Server(httpServer, {
    maxHttpBufferSize: 2 * 1e6,
  });
  setupWorker(io);

  io.on("connection", (socket) => {
    socket.on("foo", (val) => {
      socket.emit("bar", val);
    });
    socket.on("large", (val) => {
      socket.emit("large-bar", Buffer.allocUnsafe(1e6));
    });
  });
  return;
}

const WORKER_COUNT = 3;

for (let i = 0; i < WORKER_COUNT; i++) {
  cluster.fork();
}

const httpServer = http.createServer();

setupMaster(httpServer, {
  loadBalancingMethod: process.env.LB_METHOD || "least-connection",
});

const waitFor = (emitter, event) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("timeout reached"));
    }, 3000);
    emitter.once(event, () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
};

httpServer.listen(async () => {
  let exitCode = 0;
  let socket;
  try {
    const port = httpServer.address().port;
    console.log(`Listening on port ${port}`);
    const socket = ioc(`http://localhost:${port}`, {
      transports: process.env.TRANSPORT
        ? [process.env.TRANSPORT]
        : ["polling", "websocket"],
    });

    await waitFor(socket, "connect");
    console.log("uploading connected");
    const res = await fetch(`http://localhost:${port}`, {
      method: "POST",
      body: fs.readFileSync("./assets/socket.io-cluster.png"),
    });
    const text = await res.text();
    if (text != "finish") throw "response did not match";
    // cleanup
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    console.log("workers killed");
  } catch (e) {
    console.log(e);
    exitCode = 1;
  } finally {
    if (socket && socket.connected) socket.disconnect();
    httpServer.close(() => {
      process.exit(exitCode);
    });
  }
});
