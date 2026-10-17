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

  it('a window pulled out of its group gets its own button after the group', () => {
    const apps = [TASKS.apps[0], app(2, 'Safari', [win('w2', 'Apple'), win('w3', 'News'), win('w5', 'Weather')]), TASKS.apps[2]];
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = { ...TASKS, apps, ungrouped: ['w3'] }; });
    cy.get('#tasks .task .label').then(($l) => expect([...$l].map((l) => l.textContent)).to.deep.equal(['Notes.txt', 'Safari', 'News', 'Music']));
    button('Safari').find('.count').should('have.text', '2');
    button('News').rightclick();
    cy.calls('taskMenu').its(0).its(0).should('deep.include', { kind: 'window', pid: 2, id: 'w3' });
  });

  it('dragging a pulled out button onto its group puts it back', () => {
    const apps = [TASKS.apps[0], app(2, 'Safari', [win('w2', 'Apple'), win('w3', 'News'), win('w5', 'Weather')]), TASKS.apps[2]];
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = { ...TASKS, apps, ungrouped: ['w3'] }; });
    const center = ($el) => { const r = $el[0].getBoundingClientRect(); return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, button: 0 }; };
    button('News').then(($b) => cy.wrap($b).trigger('pointerdown', center($b)));
    button('Safari').then(($g) => {
      const at = center($g);
      cy.get('#tasks').trigger('pointermove', { ...at, clientX: at.clientX + 30 }).trigger('pointermove', at);
      button('Safari').should('have.class', 'target');
      cy.get('#tasks').trigger('pointerup', at);
    });
    cy.calls('regroup').should('deep.include', ['w3']);
    cy.get('#tasks .task.target').should('not.exist');
  });

  it('a drag over the bar opens a slot after the app\'s buttons', () => {
    cy.page('bar/index.html', (_state, extra) => { extra.tasks = TASKS; });
    cy.fake().then((api) => api.emit('dragOver', { pid: 2 }));
    cy.get('#tasks .task.slot').should('have.length', 1).prev().should('contain.text', 'Safari');
    cy.fake().then((api) => api.emit('dragOver', null));
    cy.get('#tasks .task.slot').should('not.exist');
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

  it('with previews on, a click on a group pins its preview instead of opening the list', () => {
    cy.page('bar/index.html', (state, extra) => {
      extra.tasks = TASKS;
      state.settings.taskbar.previews = true;
    });
    button('Safari').click();
    cy.calls('pinPreview').its(0).its(0).should((p) => {
      expect(p.pid).to.equal(2);
      expect(p.group).to.equal(true);
      expect(p.windows.map((w) => w.title)).to.deep.equal(['Apple', 'News']);
    });
    cy.calls('showGroup').should('have.length', 0);
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
