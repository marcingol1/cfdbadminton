import React, { Fragment } from 'react';
import CssBaseline from '@material-ui/core/CssBaseline';

import TopBarComponent from './top-bar/top-bar-component';
import ThemeHoc from './theme/theme-hoc';

function MyApp() {
  return (
    <ThemeHoc>
      <CssBaseline>
        <TopBarComponent />
      </CssBaseline>
    </ThemeHoc>
  );
}

export default MyApp;