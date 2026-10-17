// The Start menu, with a made up app list. The app reads the list each time
// the menu is shown, so each test sends menuShown first.
const APPS = ['Calculator', 'Calendar', 'Notes', 'Safari', 'TextEdit'].map((name) => ({ name, path: `/Applications/${name}.app`, icon: '' }));

function openMenu(change) {
  cy.page('menu/index.html', (state, extra) => {
    extra.apps = APPS;
    extra.recent = [APPS[3]];
    if (change) change(state, extra);
  });
  cy.fake().then((api) => api.emit('menuShown'));
}

describe('Start menu', () => {
  it('shows the user, recent apps, and every app under All Applications', () => {
    openMenu();
    cy.get('#user').should('have.text', 'Test User');
    cy.get('#recent .item').should('have.length', 1).and('contain', 'Safari');
    cy.get('#list .item').should('have.length', 0);
    cy.get('#all-toggle').click();
    cy.get('#list .item').should('have.length', APPS.length);
  });

  it('search narrows the list and Enter opens the first match', () => {
    openMenu();
    cy.get('#search').type('cal');
    cy.get('#list .item').should('have.length', 2);
    cy.get('#search').type('cu{enter}');
    cy.calls('launch').should('deep.equal', [['/Applications/Calculator.app']]);
  });

  it('nothing matching says so', () => {
    openMenu();
    cy.get('#search').type('zzz');
    cy.contains('#list .empty', 'Nothing matches.');
  });

  it('the arrow keys move the selection', () => {
    openMenu();
    cy.get('#search').type('a');
    cy.get('body').type('{downarrow}{downarrow}');
    cy.get('#list .item.selected').should('have.length', 1).and('contain', 'Calendar');
  });

  it('files come after the apps when search covers files', () => {
    openMenu((state, extra) => {
      state.settings.startMenu.search = 'files';
      extra.files = [{ name: 'Notes for Monday.txt', path: '/Users/test/Notes for Monday.txt', where: '~', icon: '' }];
    });
    cy.get('#search').type('notes');
    cy.contains('#list .list-head', 'Files');
    cy.contains('#list .item.file', 'Notes for Monday.txt').click();
    cy.calls('openFile').should('deep.equal', [['/Users/test/Notes for Monday.txt']]);
  });

  it('the right column follows the settings, with added folders', () => {
    openMenu((state) => {
      state.settings.startMenu.rightColumn.downloads = false;
      state.settings.startMenu.folders = ['/Users/test/Projects'];
    });
    cy.get('#right').should('contain', 'Documents').and('not.contain', 'Downloads');
    cy.contains('#right .item', 'Projects').click();
    cy.calls('openFolder').should('deep.equal', [['/Users/test/Projects']]);
  });

  it('Escape closes the menu', () => {
    openMenu();
    cy.get('body').type('{esc}');
    cy.calls('hideMenu').should('have.length', 1);
  });
});
