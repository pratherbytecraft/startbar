// cy.page('settings/index.html', change) loads a renderer page with the fake
// window.startbar in place. change(state, extra) can adjust the state and
// fill extra ({ tasks, status, apps, recent, files }) before the page reads
// them. cy.fake() yields the fake.
import { fakeStartbar, type Extra, type Fake } from './fake';
import type { State } from '../../../src/shared/types';

type Change = (state: State, extra: Extra) => void;

declare global {
  namespace Cypress {
    interface Chainable {
      page(url: string, change?: Change): Chainable<void>;
      fake(): Chainable<Fake>;
      // A tells the argument list's types, when a test reads into it.
      calls<A extends unknown[] = unknown[]>(name: string): Chainable<A[]>;
    }
  }
}

Cypress.Commands.add('page', (url: string, change?: Change) => {
  cy.task<string[]>('apiNames', null, { log: false }).then((names) => {
    cy.task<State>('startbarState', null, { log: false }).then((state) => {
      const extra: Extra = {};
      if (change) change(state, extra);
      cy.visit(`${Cypress.env('pages')}/${url}`, {
        onBeforeLoad(win) {
          win.startbar = fakeStartbar(names, state, extra);
        }
      });
    });
  });
});

Cypress.Commands.add('fake', () => cy.window({ log: false }).then((win) => win.startbar as Fake));

// The calls the page made to one of the fake's functions, as argument lists.
// Retries like any query, so should() waits for a call to come in.
Cypress.Commands.addQuery('calls', (name: string) => {
  return () => {
    // cy.state is Cypress's own, left out of its types.
    const api = (cy as unknown as { state(key: 'window'): Window }).state('window').startbar as Fake;
    return api.calls.filter((c) => c[0] === name).map((c) => c.slice(1));
  };
});
