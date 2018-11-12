import express from 'express';
import path from 'path';
import cors from 'cors';
import { ApolloServer, gql } from 'apollo-server-express';

import { prisma } from './prisma';

const typeDefs = gql`
  enum GameType {
    Deathmatch
    CaptureTheFlag
    Arena
  }
  type Player {
    id: ID
    online: Boolean
    gamesHistory: [Match]
  }
  type Match {
    score: Float
    gameType: GameType,
    players: [Player]
  }
  enum Region {
    Europe
    Asia
    NorthAmerica
    SouthAmerica
  }
  type Server {
    id: String
    title: String
    playersOnline: Int
    region: Region
    match: Match
  }

  type Query {
    servers: [Server]
  }
`

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    servers: () => {},
  },
};

const buildPath = '../build';
const server = new ApolloServer({
  typeDefs,
  mocks: true,
  // resolvers
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
