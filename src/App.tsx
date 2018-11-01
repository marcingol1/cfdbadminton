import React from 'react';
import CssBaseline from '@material-ui/core/CssBaseline';

import TopBarComponent from './top-bar/top-bar-component';
import ThemeHoc from './theme/theme-hoc';
import DashboardComponent from './dashboard/dashboard';

const appTitle = 'Crazy freakin\' deadly badminton!';

function MyApp() {
  return (
    <ThemeHoc>
      <CssBaseline>
        <TopBarComponent title={appTitle}>
          <DashboardComponent />
        </TopBarComponent>
      </CssBaseline>
    </ThemeHoc>
  );
}

export default MyApp;