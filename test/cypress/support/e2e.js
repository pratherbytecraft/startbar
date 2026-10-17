// cy.page('settings/index.html', change) loads a renderer page with the fake
// window.startbar in place. change(state, extra) can adjust the state and
// fill extra ({ tasks, status, apps, recent, files }) before the page reads
// them. cy.fake() yields the fake.
import { fakeStartbar } from './fake';

Cypress.Commands.add('page', (url, change) => {
  cy.task('apiNames', null, { log: false }).then((names) => {
    cy.task('startbarState', null, { log: false }).then((state) => {
      const extra = {};
      if (change) change(state, extra);
      cy.visit(`${Cypress.env('pages')}/${url}`, {
        onBeforeLoad(win) {
          win.startbar = fakeStartbar(names, state, extra);
        }
      });
    });
  });
});

Cypress.Commands.add('fake', () => cy.window({ log: false }).then((win) => win.startbar));

// The calls the page made to one of the fake's functions, as argument lists.
// Retries like any query, so should() waits for a call to come in.
Cypress.Commands.addQuery('calls', (name) => {
  return () => {
    const api = cy.state('window').startbar;
    return api.calls.filter((c) => c[0] === name).map((c) => c.slice(1));
  };
});
