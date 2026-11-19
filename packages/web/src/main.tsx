import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import './styles.css';
import './i18n';
import { createTheme, MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  // System fonts only: nothing is downloaded from the network.
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
);
