// The pictures over a window button, alone with the fake API.
const PAYLOAD = {
  pid: 2, icon: '', group: true,
  windows: [
    { id: 'w2', title: 'Apple', active: true, minimized: false },
    { id: 'w3', title: 'News', active: false, minimized: false },
    { id: 'w4', title: 'Mail', active: false, minimized: true }
  ]
};
const show = () => cy.fake().then((api) => api.emit('previewShow', PAYLOAD));

describe('window previews', () => {
  it('resting on a picture peeks at its window and moving off puts things back', () => {
    cy.page('preview/index.html');
    show();
    cy.get('#pv .thumb').should('have.length', 3);
    cy.contains('#pv .thumb', 'News').trigger('mouseenter');
    cy.calls('previewPeek').should('have.length', 0);
    cy.calls('previewPeek').should('deep.equal', [['w3']]);
    cy.contains('#pv .thumb', 'News').trigger('mouseleave');
    cy.calls('previewPeek').should('deep.equal', [['w3'], [null]]);
  });

  it('a minimized window is not peeked at, and a click activates without a put back', () => {
    cy.page('preview/index.html');
    show();
    cy.contains('#pv .thumb', 'Mail').trigger('mouseenter');
    cy.wait(700);
    cy.calls('previewPeek').should('have.length', 0);
    cy.contains('#pv .thumb', 'Apple').trigger('mouseenter').click();
    cy.calls('taskCommand').should('deep.include', [{ cmd: 'activate', id: 'w2' }]);
    cy.calls('hidePreview').should('have.length', 1);
    cy.wait(700);
    cy.calls('previewPeek').should('have.length', 0);
  });
});
