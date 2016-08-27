'use strict';

const flatbuffers = require('../../../flatbuffers').flatbuffers;
const RatingsRequest = require('../../../data/ratings-request_generated').Netflix.RatingsRequest;
const RatingsResponse = require('../../../data/ratings-response_generated').Netflix.RatingsResponse;
const AsAService = require('../AsAService');
const random = require('../../../data/random').random;
const Cache = require('../Cache');
const cache = new Cache();

let fbsCount = 0;
let jsonCount = 0;
let fbsVideoCount = 0;
let jsonVideoCount = 0;
const intervalId = setInterval(function _reportRPS() {
    console.log('RPS(fbs): ', fbsCount / 10);
    console.log('RPS(json): ', jsonCount / 10);
    console.log('RPS(videos.fbs): ', fbsVideoCount / 10);
    console.log('RPS(videos.json): ', jsonVideoCount / 10);

    fbsCount = jsonCount = fbsVideoCount = jsonVideoCount = 0;
}, 10000);

function responder(client, buffer) {
    const isJSON = AsAService.isJSONRequest(buffer);
    const ratingsRequest = AsAService.parse(buffer, RatingsRequest.getRootAsRatingsRequest);
    const clientId = isJSON ? ratingsRequest.clientId : ratingsRequest.clientId();
    const data = fillRequest(ratingsRequest, clientId, isJSON);
    const outBuf = toBuffer(data, isJSON);
    const requestLength = isJSON ? ratingsRequest.videos.length : ratingsRequest.videosLength();
    
    // Reporting
    if (isJSON) {
        jsonCount++;
        jsonVideoCount += requestLength;
    }
    
    else {
        fbsCount++;
        fbsVideoCount += requestLength;
    }

    console.log(data);
    client.write(AsAService.createTransportBuffer(outBuf, isJSON));
}

module.exports = responder;

function toBuffer(jsonOrArray, isJSON) {
    if (isJSON) {
        return new Buffer(JSON.stringify(jsonOrArray));
    }

    return new Buffer(jsonOrArray);
}

function fillRequest(request, clientId, isJSON) {
    let videoMap = cache.get(clientId);
    if (!videoMap) {
        videoMap = {};
        cache.insert(clientId, undefined, videoMap);
    }
    
    
    const videosLength = isJSON ? request.videos.length : request.videosLength();
    const videoRatings = [];
    for (let i = 0; i < videosLength; ++i) {
        const videoId = isJSON ? request.videos[i] : request.videos(i);
        
        // Store the result into the video ratings array if we have cached 
        // this video id.
        if (videoMap[videoId]) {
            videoRatings[i] = videoMap[videoId];
        }
        
        // generate a new rating and save it into the map
        else {
            const rating = random(50, 1);
            videoRatings[i] = videoMap[videoId] = rating;
        }
    }
    
    if (isJSON) {
        return {
            ratings: videoRatings,
            clientId: clientId
        };
    }
    
    const bb = new flatbuffers.Builder(videosLength);
    const vOffset = RatingsResponse.createRatingsVector(bb, videoRatings);
    
    RatingsResponse.startRatingsResponse(bb);
    RatingsResponse.addRatings(bb, vOffset);
    RatingsResponse.addClientId(bb, clientId);
    const offset = RatingsResponse.endRatingsResponse(bb);
    RatingsResponse.finishRatingsResponseBuffer(bb, offset);
    
    return bb.asUint8Array();
}

