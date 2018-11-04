import React, { useState, Fragment } from 'react';
import {
  List,
  ListItem,
  Button,
  ListItemText,
  ListItemAvatar,
  Avatar,
  ListItemSecondaryAction,
} from '@material-ui/core';
import GamesIcon from '@material-ui/icons/Games';

let index = 0;
const regions = ['Europe', 'Asia', 'North America', 'South America'];
const gameTypes = ['Deatmatch', 'Capture the flag', 'Arena (team DM)'];

function generateRandomListElement() {
  return {
    index: index++,
    id: `${index}asod-123-132-${index}`,
    title: 'Some random title',
    playersOnline: Math.round(Math.random() * 120),
    region: Math.round(Math.random() * (regions.length - 1)),
    gameType: Math.round(Math.random() * (gameTypes.length - 1)),
  };
}

function ListItemComponent(props) {
  const { index, title, playersOnline, region, gameType, id } = props;

  function fetchServersPage() {
    console.log('entering servers page!');
  }

  return (
    <ListItem key={index}>
      <ListItemAvatar>
        <Avatar>
          <GamesIcon />
        </Avatar>
      </ListItemAvatar>

      <ListItemText
        primary={title}
        secondary={`Players online: ${playersOnline}, region: ${region}, gameType: ${gameType}`}
      />
      <ListItemSecondaryAction onClick={fetchServersPage.bind(this, id)}>
        <Button
          variant="contained"
          color="primary"
          aria-label={`Link to details of server ${title}`}
        >
          Join
        </Button>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

const fetchPong = async () => {
  const res = await fetch('/ping');
  console.log(await res.json());
}

function ServerList() {
  const [list, setList] = useState([generateRandomListElement()]);

  function handleListChange() {
    setList([...list, generateRandomListElement()]);
  }

  fetchPong();

  return (
    <Fragment>
      <Button variant="contained" onClick={handleListChange}>
        Create your own server
      </Button>
      <List>
        {list.map((listItem, index) => (
          <ListItemComponent {...listItem} key={index} />
        ))}
      </List>
    </Fragment>
  );
}

export default ServerList;
