import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('identifies the product and transactional status', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Paper Stock Control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Núcleo transacional pronto para integração'
    );
  });
});
