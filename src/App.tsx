import React, { Fragment } from 'react';
import CssBaseline from '@material-ui/core/CssBaseline';

import TopBarComponent from './top-bar/top-bar-component';

const title = 'Crazy freakin\' deadly 🏸';
function MyApp() {
  return (
    <Fragment>
      <CssBaseline />
      <TopBarComponent title={title} />
      <h1 style={{textAlign: 'center', margin: 20}}>{title} welcome page!</h1>
    </Fragment>
  );
}

export default MyApp;