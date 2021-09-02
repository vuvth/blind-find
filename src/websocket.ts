import * as http from "http";
import express from "express";
import WebSocket from "ws";
import { AsyncEvent } from "./utils";
import { ServerNotRunning, TimeoutError, ConnectionClosed } from "./exceptions";
import { SOCKET_TIMEOUT, WS_PROTOCOL } from "./configs";
import { logger } from "./logger";

export interface IIPRateLimiter {
  allow(ip: string): boolean;
}

type TTokenBucket = { numTokens: number; timestamp: number };
export type TRateLimitParams = { numAccess: number; refreshPeriod: number };

export class TokenBucketRateLimiter implements IIPRateLimiter {
  buckets: Map<string, TTokenBucket>;

  constructor(readonly params: TRateLimitParams) {
    this.buckets = new Map<string, TTokenBucket>();
  }

  /**
   * Allow an IP to access.
   * @param ip IP address to put rate limit on.
   * @returns if the IP address is allowed now or not.
   */
  allow(ip: string): boolean {
    let bucket = this.buckets.get(ip);
    const currentTime = Date.now();
    // If ip is not in the map or it's time to refresh, refresh tokens and return true.
    if (
      bucket === undefined ||
      currentTime - bucket.timestamp > this.params.refreshPeriod
    ) {
      bucket = {
        numTokens: this.params.numAccess,
        timestamp: currentTime
      };
    }
    if (bucket.numTokens > 0) {
      this.buckets.set(ip, {
        numTokens: bucket.numTokens - 1,
        timestamp: bucket.timestamp
      });
      return true;
    } else {
      // No token for the ip available.
      return false;
    }
  }
}

export abstract class BaseServer {
  abstract name: string;
  isRunning: boolean;
  private httpServer?: http.Server;
  private wsServer?: WebSocket.Server;

  constructor() {
    this.isRunning = false;
  }

  abstract async onIncomingConnection(
    socket: IWebSocketReadWriter,
    request: http.IncomingMessage
  ): Promise<void>;

  public get address(): WebSocket.AddressInfo {
    if (this.wsServer === undefined) {
      throw new ServerNotRunning();
    }
    return this.wsServer.address() as WebSocket.AddressInfo;
  }

  async start(port?: number, hostname?: string) {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    const event = new AsyncEvent();
    const app = express();
    // TODO: Change to https.
    let webServer: http.Server;
    const newConnectionCB = () => {
      if (webServer.address() === null) {
        throw new Error("address shouldn't be null");
      }
      const port = (webServer.address() as WebSocket.AddressInfo).port;
      logger.info(`${this.name}: Listening on port ${port}`);
      event.set();
    };
    if (port === undefined) {
      webServer = app.listen(newConnectionCB);
    } else if (hostname === undefined) {
      webServer = app.listen(port, newConnectionCB);
    } else {
      webServer = app.listen(port, hostname, newConnectionCB);
    }
    const server = new WebSocket.Server({ server: webServer });
    // Wait until the websocket server is already listening.
    await event.wait();
    this.httpServer = webServer;
    this.wsServer = server;
    const handler = async (
      socket: WebSocket,
      request: http.IncomingMessage
    ): Promise<void> => {
      const rwtor = new WebSocketAsyncReadWriter(socket);
      await this.onIncomingConnection(rwtor, request);
    };
    this.wsServer.on("connection", handler.bind(this));
  }

  async waitClosed() {
    return new Promise((res, rej) => {
      if (this.wsServer === undefined) {
        rej(new Error("ws server is not listened"));
      } else {
        this.wsServer.on("close", () => {
          res();
        });
      }
    });
  }

  close() {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.httpServer === undefined || this.wsServer === undefined) {
      throw new Error("both httpServer and server should have been set");
    }
    for (const conn of this.wsServer.clients) {
      conn.close();
    }
    this.wsServer.close();
    this.httpServer.close();
  }
}

export const connect = async (
  ip: string,
  port: number
): Promise<IWebSocketReadWriter> => {
  const ws = new WebSocket(`${WS_PROTOCOL}://${ip}:${port}`);
  await new Promise(resolve => ws.once("open", resolve));
  return new WebSocketAsyncReadWriter(ws);
};

interface ICallback<T> {
  resolvePromise(t: T): void;
  rejectPromise(reason?: any): void;
  cancelTimeout(): void;
}

export interface IWebSocketReadWriter {
  read(timeout?: number): Promise<Uint8Array>;
  write(data: Uint8Array): void;
  close(): void;
  terminate(): void;
  connected: boolean;
}

// NOTE: Reference: https://github.com/jcao219/websocket-async/blob/master/src/websocket-client.js.
export class WebSocketAsyncReadWriter implements IWebSocketReadWriter {
  private closeEvent?: WebSocket.CloseEvent;
  received: Array<Uint8Array>;
  private callbackQueue: Array<ICallback<Uint8Array>>;

  constructor(readonly socket: WebSocket) {
    this.received = [];
    this.callbackQueue = [];

    this.setupListeners();
  }

  get connected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  private setupListeners() {
    const socket = this.socket;

    socket.onmessage = event => {
      if (this.callbackQueue.length !== 0) {
        const callback = this.callbackQueue.shift();
        if (callback === undefined) {
          throw new Error("should never happen");
        }
        callback.resolvePromise(new Uint8Array(event.data as Buffer));
        callback.cancelTimeout();
      } else {
        this.received.push(new Uint8Array(event.data as Buffer));
      }
    };

    socket.onclose = event => {
      this.closeEvent = event;

      // Whenever a close event fires, the socket is effectively dead.
      // It's impossible for more messages to arrive.
      // If there are any promises waiting for messages, reject them.
      while (this.callbackQueue.length !== 0) {
        const callback = this.callbackQueue.shift();
        if (callback === undefined) {
          throw new Error("should never happen");
        }
        callback.rejectPromise(this.closeEvent);
        callback.cancelTimeout();
      }
    };
  }

  async read(timeout: number = SOCKET_TIMEOUT): Promise<Uint8Array> {
    if (this.received.length !== 0) {
      const data = this.received.shift();
      if (data === undefined) {
        throw new Error("should never happen");
      }
      return data;
    }

    if (!this.connected) {
      throw new ConnectionClosed();
    }

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new TimeoutError(`timeout before receiving data: timeout=${timeout}`));
      }, timeout);
      this.callbackQueue.push({
        resolvePromise: resolve,
        rejectPromise: reject,
        cancelTimeout: () => {
          clearTimeout(t);
        }
      });
    });
  }

  write(data: Uint8Array) {
    this.socket.send(data);
  }

  close(code?: number, data?: string): void {
    if (!this.connected) {
      return;
    }
    this.socket.close(code, data);
  }

  terminate(): void {
    if (!this.connected) {
      return;
    }
    this.socket.terminate();
  }
}

/**
 * Relay messages between `initiatorSocket` and `receiverSocket`.
 */
export const relay = async (initiatorSocket: IWebSocketReadWriter, receiverSocket: IWebSocketReadWriter): Promise<void> => {
  const readAndWrite = async (socket0: IWebSocketReadWriter, socket1: IWebSocketReadWriter): Promise<void> => {
    // Only relay messages when both sides are open.
    while (socket0.connected && socket1.connected) {
      try {
        const data = await socket0.read();
        socket1.write(data);
      } catch (e) {
        // only catch `CloseEvent`
        if (!socket0.connected || !socket1.connected) {
          return;
        }
      }
    }
  };
  await Promise.race([
    readAndWrite(initiatorSocket, receiverSocket),
    readAndWrite(receiverSocket, initiatorSocket),
  ]);
  // If initiator is closed, make sure the receiver is closed.
  if (!initiatorSocket.connected) {
    receiverSocket.close();
  }
}
