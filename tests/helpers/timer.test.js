const {createTimer} = require('../../helpers/timer');
const assert = require('assert');

const timer = createTimer();

const time1 = Number(timer.getElapsedTime());

assert(time1 < 0.0000001, 'Initial time is ~0ms');

setTimeout(() => {
    const time2 = Number(timer.getElapsedTime());

    assert(time2 >= 0.1 && time2 < 0.15, `time after 100ms is ~100ms`);
}, 100);
