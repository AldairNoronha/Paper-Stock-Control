import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('identifies the product and foundation status', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Paper Stock Control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Estrutura inicial pronta para desenvolvimento'
    );
  });
});

