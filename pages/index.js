import CssBaseline from '@material-ui/core/CssBaseline';

import TopBarComponent from './../components/top-bar/top-bar-component';
import ThemeHoc from './../components/theme/theme-hoc';
import DashboardComponent from './../components/dashboard/dashboard';

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