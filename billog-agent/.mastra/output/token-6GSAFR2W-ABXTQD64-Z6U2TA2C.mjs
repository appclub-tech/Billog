import { r as require_token_util } from './chunk-OS7SAIRA.mjs';
import { _ as __commonJS, r as require_token_error } from './index.mjs';
import '@mastra/core/evals/scoreTraces';
import '@mastra/core';
import '@mastra/libsql';
import 'path';
import '@mastra/core/agent';
import '@mastra/memory';
import '@mastra/core/workspace';
import '@mastra/core/processors';
import '@mastra/core/llm';
import 'url';
import './tools/67cc85ab-293d-454d-9b13-1940c32e3fc7.mjs';
import '@mastra/core/tools';
import 'zod';
import './tools/5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import 'jsonwebtoken';
import './expense-item-vector.mjs';
import '@upstash/vector';
import './tools/551953aa-fe59-42d8-9606-409be897ed5f.mjs';
import './tools/4f253952-0728-4174-8254-b3aead25c77c.mjs';
import './tools/dd3c6095-32cb-49a7-93a2-804fbe8a95e5.mjs';
import './tools/b23b5f83-73f9-453f-9140-67fa75c14a76.mjs';
import './tools/e530ac36-49d5-4d26-a707-69d9bbca7f1f.mjs';
import './tools/4374479b-9bfc-4b45-8dc2-c39992b13757.mjs';
import './tools/652371eb-aaa1-4fa9-b64a-0de19f58ec8a.mjs';
import '@google/generative-ai';
import './tools/532da063-6b34-4743-86b3-316e3c078afd.mjs';
import '@ai-sdk/google';
import './insights.tool.mjs';
import '@mastra/core/workflows';
import './tools/285fa223-6376-40b1-a3e9-6d273fe28d8a.mjs';
import 'fs/promises';
import 'https';
import 'http';
import 'http2';
import 'stream';
import 'crypto';
import 'fs';
import '@mastra/core/utils/zod-to-json';
import '@mastra/core/features';
import '@mastra/core/request-context';
import '@mastra/core/error';
import '@mastra/core/utils';
import '@mastra/core/evals';
import '@mastra/core/storage';
import '@mastra/core/a2a';
import 'stream/web';
import 'zod/v4';
import 'zod/v3';
import '@mastra/core/memory';
import 'child_process';
import 'module';
import 'util';
import 'os';
import '@mastra/core/server';
import 'buffer';
import './tools.mjs';

// ../memory/dist/token-6GSAFR2W-ABXTQD64.js
var require_token = __commonJS({
  "../../../node_modules/.pnpm/@vercel+oidc@3.0.5/node_modules/@vercel/oidc/dist/token.js"(exports$1, module) {
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var token_exports = {};
    __export(token_exports, {
      refreshToken: () => refreshToken
    });
    module.exports = __toCommonJS(token_exports);
    var import_token_error = require_token_error();
    var import_token_util = require_token_util();
    async function refreshToken() {
      const { projectId, teamId } = (0, import_token_util.findProjectInfo)();
      let maybeToken = (0, import_token_util.loadToken)(projectId);
      if (!maybeToken || (0, import_token_util.isExpired)((0, import_token_util.getTokenPayload)(maybeToken.token))) {
        const authToken = (0, import_token_util.getVercelCliToken)();
        if (!authToken) {
          throw new import_token_error.VercelOidcTokenError(
            "Failed to refresh OIDC token: login to vercel cli"
          );
        }
        if (!projectId) {
          throw new import_token_error.VercelOidcTokenError(
            "Failed to refresh OIDC token: project id not found"
          );
        }
        maybeToken = await (0, import_token_util.getVercelOidcToken)(authToken, projectId, teamId);
        if (!maybeToken) {
          throw new import_token_error.VercelOidcTokenError("Failed to refresh OIDC token");
        }
        (0, import_token_util.saveToken)(maybeToken, projectId);
      }
      process.env.VERCEL_OIDC_TOKEN = maybeToken.token;
      return;
    }
  }
});
var token6GSAFR2W = require_token();

export { token6GSAFR2W as default };
