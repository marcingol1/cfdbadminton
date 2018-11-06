import express from 'express';
import path from 'path';
import cors from 'cors';
import { ApolloServer, gql } from 'apollo-server-express';

const { prisma } = require('./prisma');

const regions = ['Europe', 'Asia', 'NorthAmerica', 'SouthAmerica'];
const gameTypes = ['Deathmatch', 'CaptureTheFlag', 'Arena'];

function generateRandomListElement() {
  return {
    id: `asod-123-132`,
    title: 'Some random title',
    playersOnline: Math.round(Math.random() * 120),
    region: regions[Math.floor(Math.random() * (regions.length))],
    match: {
      score: Math.round(Math.random() * 100),
      gameType: gameTypes[Math.floor(Math.random() * (gameTypes.length))],
      players: [
        {
          id: 'asda-jakies-id',
          online: true,
          gamesHistory: [{
            score: Math.round(Math.random() * 100),
            gameType: gameTypes[Math.floor(Math.random() * (gameTypes.length))],
          }]
        }
      ]
    }
  };
}
const servers = (new Array(15)).fill({}).map(generateRandomListElement);
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
    servers: () => servers,
  },
};

const buildPath = '../build';
const server = new ApolloServer({ typeDefs, resolvers });

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

// A `main` function so that we can use async/await
async function main() {

  // Create a new user called `Alice`
  const newUser = await prisma.createUser({ name: 'Alice' })
  console.log(`Created new user: ${newUser.name} (ID: ${newUser.id})`)

  // Read all users from the database and print them to the console
  const allUsers = await prisma.users()
  console.log(allUsers)
}

main().catch(e => console.error(e))

app.listen(port, () => {
  console.log(`🚀 GraphQL endpoint ready at http://localhost:8080${server.graphqlPath}`);
  console.log('🚀 Default API endpoint hosted at http://localhost:3000');
});
