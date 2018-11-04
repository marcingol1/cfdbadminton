import React from 'react';
import CssBaseline from '@material-ui/core/CssBaseline';

import DashboardComponent from './components/dashboard/dashboard';
import ThemeHoc from './components/theme/theme-hoc';
import TopBarComponent from './components/top-bar/top-bar-component';

const appTitle = 'Crazy freakin\' deadly badminton!';

const App = () => (
  <ThemeHoc>
    <CssBaseline>
      <TopBarComponent title={appTitle}>
        <DashboardComponent />
      </TopBarComponent>
    </CssBaseline>
  </ThemeHoc>
);

export default App;
