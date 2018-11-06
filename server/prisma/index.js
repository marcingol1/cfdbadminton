/* // import { PrismaClientLib } from 'prisma-client-lib';
import { typeDefs } from './prisma-schema';
const PrismaClientLib = require("prisma-client-lib");

console.log(PrismaClientLib);
const Prisma = PrismaClientLib.makePrismaClientClass({
  typeDefs,
  endpoint: `http://localhost:4466`,
});

export default Prisma(); */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var prisma_lib_1 = require("prisma-client-lib");
var typeDefs = require("./prisma-schema").typeDefs;

exports.Prisma = prisma_lib_1.makePrismaClientClass({
  typeDefs,
  endpoint: `http://localhost:4466`
});
exports.prisma = new exports.Prisma();
