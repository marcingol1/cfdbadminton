import express from 'express';
import path from 'path';
import cors from 'cors';
import { ApolloServer } from 'apollo-server-express';

import { prisma } from './prisma';

import typeDefs from './schema/main';

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    servers: () => {},
  },
};

const buildPath = '../build';
const server = new ApolloServer({
  typeDefs,
  formatError: error => {
    console.log(error);
    return error;
  },
  formatResponse: response => {
    console.log(response);
    return response;
  },
  // resolvers
  mocks: true,
});

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, buildPath)));

app.get('/ping', function (req, res) {
  return res.send(JSON.stringify('pong'));
 });

 app.get('/', function (req, res) {
   res.sendFile(path.join(__dirname, buildPath, 'index.html'));
 });

server.applyMiddleware({ app });
const port = process.env.PORT || 8080;

app.listen({ port }, () => {
  console.log(`\n🚀 Server ready at: http://localhost:${port}${server.graphqlPath}\n`);
});
