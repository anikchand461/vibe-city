import test from 'node:test';
import assert from 'node:assert/strict';
import { roadFare, transitFare } from '../src/fares.js';

test('Metro fares change at the published distance slab boundaries', () => {
  assert.equal(transitFare('metro', 2000), 5);
  assert.equal(transitFare('metro', 2001), 10);
  assert.equal(transitFare('metro', 5000), 10);
  assert.equal(transitFare('metro', 5001), 15);
  assert.equal(transitFare('metro', 20001), 25);
  assert.equal(transitFare('metro', 8000, 'Green Line'), 20);
  assert.equal(transitFare('metro', 12000, 'Green Line'), 30);
});

test('local, bus, tram and express fares use the centralized tables', () => {
  assert.equal(transitFare('train', 0), 5);
  assert.equal(transitFare('train', 5001), 10);
  assert.equal(transitFare('train', 40000), 40);
  assert.equal(transitFare('bus', 1000), 10);
  assert.equal(transitFare('bus', 12000), 20);
  assert.equal(transitFare('tram', 3000), 8);
  assert.equal(transitFare('express', 1000), 120);
});

test('road fares preserve the flag-fall and per-kilometre meter', () => {
  assert.equal(roadFare('taxi', 2000), 30);
  assert.equal(roadFare('taxi', 3000), 45);
  assert.equal(roadFare('auto', 1500), 20);
});
