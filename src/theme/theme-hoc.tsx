import React, { Fragment } from 'react'
import { MuiThemeProvider, createMuiTheme } from '@material-ui/core/styles';
import indigo from '@material-ui/core/colors/indigo';
import pink from '@material-ui/core/colors/pink';

interface InterfaceThemeHocProps {
  children?: object;
  dark?: boolean;
}

const theme = (isDark: boolean = false) => createMuiTheme({
  palette: {
    primary: indigo,
    secondary: pink,
    ...(isDark ? { type: 'dark' } : null)
  }
});

const ThemeHoc = (props: InterfaceThemeHocProps) => {
  return (
    <MuiThemeProvider theme={theme(props.dark)}>
      {props.children}
    </MuiThemeProvider>
  )
}

export default ThemeHoc

