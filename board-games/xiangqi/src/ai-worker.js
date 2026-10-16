import { search } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const result = search(data.board, data.side, { milliseconds: data.milliseconds, onProgress: result => self.postMessage({ type: 'progress', result, ticket: data.ticket }) });
    self.postMessage({ type: 'done', result, ticket: data.ticket });
  } catch (e) { self.postMessage({ type: 'error', error: e.message, ticket: data.ticket }); }
};
