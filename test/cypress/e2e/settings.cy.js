// The settings window, with every setting at its default unless a test says.
const row = (label) => cy.contains('#pages .row .lbl', label).closest('.row');
const open = (title) => cy.contains('#nav a', title).click();

describe('settings window', () => {
  it('draws every page from the sidebar', () => {
    cy.page('settings/index.html');
    for (const title of ['Appearance', 'Taskbar', 'Start Menu', 'Clock and Tray', 'Displays', 'General', 'Permissions']) {
      open(title);
      cy.get('#title').should('have.text', title);
      cy.get('#pages .group').should('have.length.greaterThan', 0);
    }
    open('About');
    cy.contains('#pages', 'Version 9.9.9');
  });

  it('opens on the page in the address', () => {
    cy.page('settings/index.html#general');
    cy.get('#title').should('have.text', 'General');
  });

  it('search finds rows on every page, and Escape clears it', () => {
    cy.page('settings/index.html');
    cy.get('#q').type('seconds');
    cy.get('#title').should('have.text', 'Search');
    cy.contains('#pages h2', 'Clock and Tray');
    row('Show seconds').should('exist');
    cy.get('#q').clear().type('zzzz nothing');
    cy.contains('#pages', 'No settings match.');
    cy.get('#q').type('{esc}');
    cy.get('#q').should('have.value', '');
    cy.get('#title').should('have.text', 'Appearance');
  });

  it('a switch sends the setting and shows the new state', () => {
    cy.page('settings/index.html');
    open('Clock and Tray');
    row('Show seconds').find('.toggle').should('not.have.class', 'on').click();
    cy.calls('updateSettings').should('deep.include', [{ clock: { seconds: true } }]);
    row('Show seconds').find('.toggle').should('have.class', 'on');
  });

  it('a list and a segmented control send their values', () => {
    cy.page('settings/index.html');
    row('Theme').find('select').select('classic-1995');
    cy.calls('updateSettings').should('deep.include', [{ theme: 'classic-1995' }]);
    row('Appearance').find('.seg span').contains('Dark').click();
    cy.calls('updateSettings').should('deep.include', [{ appearance: 'dark' }]);
    row('Appearance').contains('.seg span', 'Dark').should('have.class', 'on');
  });

  it('the stepper stays within its limits', () => {
    cy.page('settings/index.html', (state) => {
      state.settings.startMenu.recentCount = 5;
    });
    open('Start Menu');
    row('How many').find('.arrows i').first().click();
    cy.calls('updateSettings').should('deep.include', [{ startMenu: { recentCount: 5 } }]);
    row('How many').find('.arrows i').last().click();
    cy.calls('updateSettings').should('deep.include', [{ startMenu: { recentCount: 4 } }]);
    row('How many').find('.box').should('have.text', '4');
  });

  it('pinned apps list with a Remove button each, and Add asks for more', () => {
    cy.page('settings/index.html', (state) => {
      state.pins = ['/Applications/Safari.app', '/System/Applications/Notes.app'];
    });
    open('Taskbar');
    cy.get('.paths .row[data-key]').should('have.length', 2).first().should('contain', 'Safari');
    cy.get('.paths .row[data-key]').last().contains('.btn', 'Remove').click();
    cy.calls('unpin').should('deep.equal', [['/System/Applications/Notes.app']]);
    row('Pin an app').contains('.btn', 'Add…').click();
    cy.calls('addPins').should('have.length', 1);
  });

  describe('Apps group on General', () => {
    it('the list is greyed while the switch is off, with the always left apps first', () => {
      cy.page('settings/index.html');
      open('General');
      row('Quit apps when their last window closes').find('.toggle').should('not.have.class', 'on');
      cy.contains('.paths .row.fixed', 'Finder').should('contain', 'Always left running');
      cy.get('.paths.unused').should('exist');
      row('Leave these apps running').should('have.class', 'unused');
    });

    it('turning it on brings the list in, and Add and Remove call the app', () => {
      cy.page('settings/index.html', (state) => {
        state.settings.quitApps.keepRunning = ['/System/Applications/Music.app'];
      });
      open('General');
      row('Quit apps when their last window closes').find('.toggle').click();
      cy.calls('updateSettings').should('deep.include', [{ quitApps: { on: true } }]);
      cy.get('.paths.unused').should('not.exist');
      row('Leave these apps running').contains('.btn', 'Add…').click();
      cy.calls('addKeepRunning').should('have.length', 1);
      cy.contains('.paths .row[data-key]', 'Music').contains('.btn', 'Remove').click();
      cy.calls('setKeepRunning').should('deep.equal', [[[]]]);
    });

    it('warns while Swift Quit runs alongside', () => {
      cy.page('settings/index.html', (state) => {
        state.settings.quitApps.on = true;
        state.swiftQuit = true;
      });
      open('General');
      row('Quit apps when their last window closes').find('.hint.warn').should('be.visible').and('contain', 'Swift Quit is running');
    });
  });

  it('About shows the update line for how Startbar was installed, with a Copy button', () => {
    cy.page('settings/index.html', (state) => {
      state.updateCommand = 'brew upgrade startbar';
      state.update = { state: 'available', latest: '9.9.10' };
    });
    open('About');
    cy.contains('#pages .update', 'Version 9.9.10 is available. Run the line below in Terminal, then quit Startbar and open it again.');
    cy.get('#pages .install code').should('have.text', 'brew upgrade startbar');
    cy.get('#pages .install').contains('.btn', 'Copy').click();
    cy.calls('copyText').should('deep.equal', [['brew upgrade startbar']]);
    cy.get('#pages .install .btn').should('have.text', 'Copied');
  });

  it('the Folders group shows only once Filedrawer is installed', () => {
    cy.page('settings/index.html');
    open('General');
    cy.contains('#pages h2', 'Folders').should('not.be.visible');
    cy.fake().then((api) => api.emit('state', { ...api.state, filedrawer: true }));
    cy.contains('#pages h2', 'Folders').should('be.visible');
  });
});
