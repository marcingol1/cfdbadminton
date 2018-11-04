import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core';

import ServerList from './../server-list/server-list';

const styles = (theme) => ({
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    ...theme.mixins.toolbar,
    justifyContent: 'flex-end',
  }
});

export class DashboardComponent extends Component {
  static propTypes = {
    classes: PropTypes.object,
  }

  render() {
    const { classes } = this.props;
    return (
      <Fragment >
          <div className={classes.drawerHeader} />
          <ServerList />
      </Fragment>
    );
  }
}

export default withStyles(styles, { withTheme: true })(DashboardComponent);
