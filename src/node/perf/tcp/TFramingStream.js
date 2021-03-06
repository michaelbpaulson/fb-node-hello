'use strict';

const Transform = require('stream').Transform;
const inherits = require('util').inherits;

// BIG pool size.
Buffer.poolSize = 1048576;
const objectMode = {objectMode: true};

const FramingStream = function _FramingStream() {
    Transform.call(this, objectMode);
    this._buf = null;
    this._len = 0;
    this._totalLength = 0;
};

module.exports = FramingStream;

inherits(FramingStream, Transform);

FramingStream.prototype._transform = function _transform(chunk, enc, cb) {

    // If there is a partial length floating around, prepend it and then
    // start the aggregator algo.
    // start = 0 in this situation.
    if (this._lenPartial) {
        chunk = Buffer.concat([this._lenPartial, chunk]);
        this._lenPartial = null;
    }

    // auto assumes that the first 32 bits is an unsigned int.
    let frameMark = 0;
    const chunkLength = chunk.length;

    // Why a doWhile?  Because they are awesome.
    do {

        // Buf is empty, therefore there is no previous results.
        // Therefore, we must initialize our aggregator.
        if (this._buf === null) {
            frameMark = this._initializeAggregator(chunk, frameMark);
            if (frameMark === null) {
                break;
            }
        }


        const remainingLength = chunkLength - frameMark;

        // We must frame this stream with the next incoming data.
        if (this._totalLength > this._len + remainingLength && remainingLength) {

            this._bufs.push(chunk);
            this._bufs.push(frameMark);
            this._len += remainingLength;

            frameMark += remainingLength;
        }

        // What remains in this chunk is the data we expect.
        else if (this._totalLength === this._len + remainingLength) {

            // Pass the remaining data to the next item.
            const data = this._aggregate(chunk, frameMark);

            this.__push(data);
            this._buf = null;

            frameMark += remainingLength;
        }

        // There is more than one message in this chunk.
        else if (remainingLength) {
            const endIndex = frameMark + (this._totalLength - this._len);
            const aggregatedData = this._aggregate(chunk, frameMark, endIndex);

            this.__push(aggregatedData);
            this._buf = null;

            frameMark = endIndex;
        }

    } while (frameMark < chunk.length);

    cb();
};

FramingStream.prototype._flush = function _flush() { };

FramingStream.prototype._initializeAggregator = function _initAgg(chunk, start) {

    // Edge case, we cannot read the integer
    if (chunk.length - start < 4 && !this._lenPartial) {
        this._lenPartial = chunk.slice(start);
        return null;
    }

    this._totalLength = chunk.readUInt32LE(start);
    this._len = 0;

    // Preallocate the whole buffer at once.  Store an array bufs then splice
    // them into the overall buffer.
    this._buf = true;

    // Include the length buffer as part of the buffer that way the construction
    // of the original buffer + new buffer is clean.
    this._bufs = [];
    return start;
};

/**
 * This is the sauce of the algorithm.
 * @param buf
 * @private
 */
FramingStream.prototype._aggregate = function _aggregate(chunk, startIndex, endIndex) {
    endIndex = endIndex || chunk.length;

    // copy messages
    const bufs = this._bufs;
    const chunkSliceLength = endIndex - startIndex;
    let buf = null;

    // only alloc the buf if needed.
    if (bufs.length > 0) {
        buf = Buffer.allocUnsafe(this._totalLength);
    }

    // Base case, the chunk is the message.
    if (bufs.length === 0) {
        if (startIndex === 0 && endIndex === chunk.length) {
            return chunk;
        }
        return chunk.slice(startIndex, endIndex);
    }

    // Add all previous bufs to the beginning.
    let idx = 0;
    for (let i = 0; i < bufs.length; i += 2) {
        const b = bufs[i];
        const bStartIndex = bufs[i + 1];

        b.copy(buf, idx, bStartIndex);

        idx += b.length - bStartIndex;
    }

    chunk.copy(buf, idx, startIndex, endIndex);
    return buf;
};

// I dundered to ensure that I do not collide with the stream API.  :)
FramingStream.prototype.__push = function __push(aggregatedData) {

    // I will consider making a class for this return type if it improves
    // performance.  I do not want to make to many micro ops as there are plenty
    // of fish still left in the sea.
    this.push({

        // Original, length and all.
        original: aggregatedData,

        // Strip off the length argument so that the AsAService can use this
        // buffer
        unparsed: aggregatedData.slice(4),

        // The parsed object from the parse stream
        parsed: null,

        // If the object is JSON or flatbuffers.
        isJSON: false,

        clientId: 0,

        // The lolomo request object
        lolomo: null,

        lolomoRaw: null,

        ids: null
    });
}
