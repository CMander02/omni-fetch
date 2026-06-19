import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBiliAiOutline } from '../src/platforms/bilibili/index.ts';

test('normalizeBiliAiOutline creates summary, time kv, detail kv, and segments', () => {
  const outline = normalizeBiliAiOutline({
    summary: '整体总结',
    outline: [
      {
        timestamp: 1,
        title: '第一段',
        part_outline: [
          { timestamp: 25, content: '第一个要点' },
          { timestamp: 44, content: '第二个要点' },
        ],
      },
      {
        timestamp: 338,
        title: '第二段',
        part_outline: [{ timestamp: 386, content: '第三个要点' }],
      },
    ],
  });

  assert.equal(outline.summary, '整体总结');
  assert.deepEqual(outline.time_kv, {
    '00:01': '第一段',
    '05:38': '第二段',
  });
  assert.deepEqual(outline.detail_kv, {
    '00:25': '第一个要点',
    '00:44': '第二个要点',
    '06:26': '第三个要点',
  });
  assert.equal(outline.segments.length, 2);
  assert.equal(outline.segments[0].details[0].segment_title, '第一段');
  assert.equal(outline.details.length, 3);
});
