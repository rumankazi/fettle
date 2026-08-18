import { describe, expect, it } from 'vitest';
import { buildHealthReport, type RuleResult } from '@fettle/core';
import { prettyOptions, renderPretty } from '../src/pretty.js';

const ESC = String.fromCharCode(27);
const GENERATED_AT = new Date('2026-08-18T09:00:00.000Z');

const plain = prettyOptions({}, false);
const coloured = prettyOptions({}, true);

function report(rules: RuleResult[], repo = 'acme/demo') {
  return buildHealthReport([{ repo, defaultBranch: 'main', rules }], GENERATED_AT);
}

const passing: RuleResult = {
  id: 'codeowners',
  status: 'pass',
  score: 100,
  weight: 1,
  evidence: 'CODEOWNERS found at .github/CODEOWNERS.',
};

describe('prettyOptions', () => {
  it('colours a terminal', () => {
    expect(prettyOptions({}, true).colour).toBe(true);
  });

  it('does not colour a pipe, so redirected output stays clean', () => {
    expect(prettyOptions({}, false).colour).toBe(false);
  });

  it('honours NO_COLOR even in a terminal', () => {
    expect(prettyOptions({ NO_COLOR: '1' }, true).colour).toBe(false);
  });

  it('honours FORCE_COLOR even in a pipe, which is how CI captures colour', () => {
    expect(prettyOptions({ FORCE_COLOR: '1' }, false).colour).toBe(true);
    expect(prettyOptions({ FORCE_COLOR: '0' }, false).colour).toBe(false);
  });

  it('treats a dumb terminal as colourless', () => {
    expect(prettyOptions({ TERM: 'dumb' }, true).colour).toBe(false);
  });

  it('keeps the width usable whatever the terminal claims', () => {
    expect(prettyOptions({}, true, 20).width).toBe(60);
    expect(prettyOptions({}, true, 400).width).toBe(120);
    expect(prettyOptions({}, true, 90).width).toBe(90);
  });
});

describe('renderPretty', () => {
  it('shows the repository, its grade and every rule', () => {
    const out = renderPretty(report([passing]), plain);

    expect(out).toContain('acme/demo');
    expect(out).toContain('A 100.0');
    expect(out).toContain('codeowners');
    expect(out).toContain('CODEOWNERS found');
  });

  it('emits no escape codes when colour is off', () => {
    expect(renderPretty(report([passing]), plain)).not.toContain(ESC);
  });

  it('emits escape codes when colour is on', () => {
    expect(renderPretty(report([passing]), coloured)).toContain(ESC);
  });

  it('stays readable without colour, because the status is a word not a hue', () => {
    const failing = renderPretty(
      report([{ ...passing, status: 'fail', score: 0, evidence: 'No CODEOWNERS.' }]),
      plain,
    );

    expect(failing).toContain('FAIL');
    expect(failing).not.toContain('ok ');
  });

  // The repo name and the evidence are free-form; the rule id is a closed union of
  // short literals, so only these two can overflow.
  it('keeps every line inside the terminal width', () => {
    const narrow = { colour: false, width: 60 };
    const out = renderPretty(
      report(
        [
          { ...passing, evidence: 'x'.repeat(400) },
          { ...passing, status: 'na', score: null, evidence: 'y'.repeat(400) },
        ],
        'a/'.repeat(60),
      ),
      narrow,
    );

    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(narrow.width);
  });

  it('calls out checks that could not run, with the repository they belong to', () => {
    const out = renderPretty(
      report([
        { ...passing },
        {
          id: 'branch_protection',
          status: 'na',
          score: null,
          weight: 3,
          evidence: 'token lacks administration:read',
        },
      ]),
      plain,
    );

    expect(out).toContain('Checks that could not run');
    expect(out).toContain('acme/demo branch_protection');
    expect(out).toContain('administration:read');
  });

  it('shows a dash rather than a number for an unscored rule', () => {
    const out = renderPretty(
      report([{ ...passing, status: 'na', score: null, evidence: 'no access' }]),
      plain,
    );
    expect(out).toContain('n/a');
    expect(out).not.toContain('null');
  });

  it('summarises a fleet, and says so only when there is more than one', () => {
    expect(renderPretty(report([passing]), plain)).toContain('1 repository');

    const fleet = buildHealthReport(
      [
        { repo: 'acme/a', defaultBranch: 'main', rules: [passing] },
        {
          repo: 'acme/b',
          defaultBranch: 'main',
          rules: [{ ...passing, score: 0, status: 'fail' }],
        },
      ],
      GENERATED_AT,
    );
    expect(renderPretty(fleet, plain)).toContain('2 repositories, average 50.0');
  });

  it('says something rather than nothing for an empty scan', () => {
    expect(renderPretty(buildHealthReport([], GENERATED_AT), plain)).toContain(
      'no repositories scanned',
    );
  });
});
