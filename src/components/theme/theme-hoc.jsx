import React from 'react'
import { MuiThemeProvider, createMuiTheme } from '@material-ui/core/styles';
import indigo from '@material-ui/core/colors/indigo';
import pink from '@material-ui/core/colors/pink';

const theme = (isDark = false) => createMuiTheme({
  palette: {
    primary: indigo,
    secondary: pink,
    ...(isDark ? { type: 'dark' } : null)
  }
});

const ThemeHoc = (props) => {
  return (
    <MuiThemeProvider theme={theme(props.dark)}>
      {props.children}
    </MuiThemeProvider>
  )
}

export default ThemeHoc

