'use strict';

module.exports = function limiter(maxCount, fn) {
    let count = 0;
    return function _limiter() {

        if (count < maxCount) {
            count++;

            fn.apply(null, arguments);
            return true;
        }

        return false;
    };
};
