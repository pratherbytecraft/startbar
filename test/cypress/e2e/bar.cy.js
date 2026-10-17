// The bar, drawn from a made up window list.
const win = (id, title, extra = {}) => ({ id, order: Number(id.slice(1)), title, minimized: false, focused: false, onScreen: true, otherSpace: false, fullScreen: false, x: 0, y: 30, w: 600, h: 400, ...extra });
const app = (pid, name, windows, extra = {}) => ({ pid, name, bundleId: `com.example.${pid}`, path: `/Applications/${name}.app`, active: false, hidden: false, windows, ...extra });

const TASKS = {
  accessibility: true,
  apps: [
    app(1, 'TextEdit', [win('w1', 'Notes.txt', { focused: true })], { active: true }),
    app(2, 'Safari', [win('w2', 'Apple'), win('w3', 'News')]),
    app(3, 'Music', [win('w4', 'Music', { minimized: true })])
  ]
};

const button = (text) => cy.contains('#tasks .task', text);

describe('bar', () => {
  it('draws a button per window, two windows of one app grouped', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = TASKS; });
    cy.get('#tasks .task').should('have.length', 3);
    button('Notes.txt').should('have.class', 'active');
    button('Safari').find('.count').should('have.text', '2');
    button('Music').should('have.class', 'dim');
  });

  it('never grouping gives each window its own button', () => {
    cy.page('bar/index.html', (state, extra) => {
      extra.tasks = TASKS;
      state.settings.taskbar.grouping = 'never';
    });
    cy.get('#tasks .task').should('have.length', 4);
    button('Apple').should('exist');
    button('News').should('exist');
  });

  it('a click brings a window forward, minimizes the active one, and opens a group list', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = TASKS; });
    button('Music').click();
    cy.calls('taskCommand').should('deep.include', [{ cmd: 'activate', id: 'w4' }]);
    button('Notes.txt').click();
    cy.calls('taskCommand').should('deep.include', [{ cmd: 'minimize', id: 'w1' }]);
    button('Safari').click();
    cy.calls('showGroup').its(0).its(0).should((g) => {
      expect(g.pid).to.equal(2);
      expect(g.windows.map((w) => w.title)).to.deep.equal(['Apple', 'News']);
    });
  });

  it('right click asks for the button menu, middle click for a new window', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = TASKS; });
    button('Notes.txt').rightclick();
    cy.calls('taskMenu').its(0).its(0).should('deep.include', { kind: 'window', pid: 1, id: 'w1' });
    button('Safari').trigger('auxclick', { button: 1 });
    cy.calls('taskCommand').should('deep.include', [{ cmd: 'newWindow', pid: 2 }]);
  });

  it('without Accessibility each app gets one button', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = { ...TASKS, accessibility: false }; });
    cy.get('#tasks .task').should('have.length', 3);
    button('Safari').click();
    cy.calls('taskCommand').should('deep.include', [{ cmd: 'activateApp', pid: 2 }]);
  });

  it('a new window list redraws the buttons', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = TASKS; });
    cy.get('#tasks .task').should('have.length', 3);
    cy.fake().then((api) => api.emit('tasks', { accessibility: true, apps: [TASKS.apps[0]] }));
    cy.get('#tasks .task').should('have.length', 1);
  });

  it('pins launch their app, and Start opens the menu', () => {
    cy.page('bar/index.html', (state) => { state.pins = ['/Applications/Safari.app', '/System/Applications/Notes.app']; });
    cy.get('#quick .icon').should('have.length', 2).last().click();
    cy.calls('launchPin').should('deep.equal', [['/System/Applications/Notes.app']]);
    cy.get('#start').click();
    cy.calls('clickStart').should('have.length', 1);
  });

  it('the clock shows the time', () => {
    cy.clock(new Date(2026, 9, 18, 14, 5).getTime());
    cy.page('bar/index.html');
    cy.get('#time').invoke('text').should('match', /2:05\s?PM/);
  });
});
