"use strict";
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spread = (this && this.__spread) || function () {
    for (var ar = [], i = 0; i < arguments.length; i++) ar = ar.concat(__read(arguments[i]));
    return ar;
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
exports.__esModule = true;
var readline = require("readline");
var Acceptor = /** @class */ (function () {
    function Acceptor(index, network) {
        this.name = "A" + (index + 1);
        this.failed = false;
        this.network = network;
        this.highestPromisedNumber = null;
        this.highestAccepted = null;
    }
    Acceptor.prototype.respondToMessage = function (m, type, value, prior) {
        if (value === void 0) { value = null; }
        if (prior === void 0) { prior = null; }
        var msg = new Message(this, m.src, type, value, m.number, prior);
        this.network.queueMessage(msg);
        return msg;
    };
    Acceptor.prototype.deliverMessage = function (m) {
        switch (m.type) {
            case MessageType.PREPARE:
                if (!this.highestPromisedNumber || m.number > this.highestPromisedNumber) {
                    var promise = this.respondToMessage(m, MessageType.PROMISE, null, this.highestAccepted);
                    this.highestPromisedNumber = promise.number;
                }
                break;
            case MessageType.ACCEPT:
                if (this.highestPromisedNumber && m.number < this.highestPromisedNumber)
                    this.respondToMessage(m, MessageType.REJECTED);
                else {
                    var acceptMsg = this.respondToMessage(m, MessageType.ACCEPTED, m.value);
                    if (!this.highestAccepted || m.number > this.highestAccepted.number)
                        this.highestAccepted = acceptMsg;
                }
        }
    };
    return Acceptor;
}());
var Proposal = /** @class */ (function () {
    function Proposal(value, number) {
        this.promises = new Map();
        this.accepts = new Set();
        this.rejects = new Set();
        this.restarted = false;
        this.sentAccept = false;
        this.value = value;
        this.decidedValue = value;
        this.number = number;
    }
    Proposal.prototype.getValueToSend = function () {
        var priorValue = null;
        var priorNumber = -1;
        __spread(this.promises.values()).forEach(function (m) {
            if (m.prior && m.prior.number > priorNumber) {
                priorValue = m.prior.value;
                priorNumber = m.prior.number;
            }
        });
        this.decidedValue = priorValue ? priorValue : this.value;
        return this.decidedValue;
    };
    return Proposal;
}());
var Proposer = /** @class */ (function () {
    function Proposer(index, network, acceptors) {
        this.name = "P" + (index + 1);
        this.failed = false;
        this.network = network;
        this.acceptors = acceptors;
        this.proposals = new Map();
    }
    Proposer.prototype.sendToAllAcceptors = function (type, value, number) {
        var _this = this;
        this.acceptors.forEach(function (a) { return _this.network.queueMessage(new Message(_this, a, type, value, number)); });
    };
    Proposer.prototype.startProposal = function (value) {
        var pNum = Proposer.getProposalNumber();
        this.sendToAllAcceptors(MessageType.PREPARE, null, pNum);
        this.proposals.set(pNum, new Proposal(value, pNum));
    };
    Proposer.prototype.deliverMessage = function (m) {
        switch (m.type) {
            case MessageType.PROPOSE:
                {
                    // A proposer selects a proposal number n and sends a prepare
                    // request with number n to a majority of acceptors.
                    this.startProposal(m.value);
                    break;
                }
            case MessageType.PROMISE:
                {
                    var proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in PROMISE ", m);
                    proposal.promises.set(m.src, m);
                    // If the proposer receives a response to its prepare requests
                    // (numbered n) from a majority of acceptors,
                    // get the latest proposal
                    if (proposal.promises.size > this.acceptors.length / 2 && !proposal.sentAccept) {
                        this.sendToAllAcceptors(MessageType.ACCEPT, proposal.getValueToSend(), proposal.number);
                        proposal.sentAccept = true;
                    }
                    break;
                }
            case MessageType.ACCEPTED:
                {
                    var proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in ACCEPTED ", m);
                    proposal.accepts.add(m.src);
                    break;
                }
            case MessageType.REJECTED:
                {
                    var proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in ACCEPTED ", m);
                    proposal.rejects.add(m.src);
                    if (proposal.rejects.size > this.acceptors.length / 2 && !proposal.restarted) {
                        proposal.restarted = true;
                        this.startProposal(proposal.value);
                    }
                    break;
                }
            default:
                console.log(m.type, " not handled");
        }
    };
    Proposer.proposalNumber = 1;
    Proposer.getProposalNumber = function () {
        return Proposer.proposalNumber++;
    };
    return Proposer;
}());
var MessageType;
(function (MessageType) {
    MessageType["PROPOSE"] = "PROPOSE";
    MessageType["PREPARE"] = "PREPARE";
    MessageType["PROMISE"] = "PROMISE";
    MessageType["ACCEPT"] = "ACCEPT";
    MessageType["ACCEPTED"] = "ACCEPTED";
    MessageType["REJECTED"] = "REJECTED";
})(MessageType || (MessageType = {}));
var Message = /** @class */ (function () {
    function Message(src, dst, type, value, number, prior) {
        if (value === void 0) { value = null; }
        if (number === void 0) { number = null; }
        if (prior === void 0) { prior = null; }
        this.src = src;
        this.dst = dst;
        this.type = type;
        this.value = value;
        this.number = number;
        this.prior = prior;
    }
    Message.prototype.toString = function () {
        var toReturn = (this.src != null ? this.src.name : "  ") + " -> " + this.dst.name + "  " + this.type;
        if (this.number)
            toReturn += " n=" + this.number;
        if (this.value)
            toReturn += " v=" + this.value;
        if (this.type === MessageType.PROMISE)
            toReturn += " (Prior: " + (this.prior != null ? "n=" + this.prior.number + ", v=" + this.prior.value : "None") + ")";
        return toReturn;
    };
    return Message;
}());
var Network = /** @class */ (function () {
    function Network() {
        this.queue = [];
    }
    Network.prototype.queueMessage = function (m) {
        this.queue.push(m);
    };
    Network.prototype.queueEmpty = function () {
        return this.queue.length == 0;
    };
    Network.prototype.extractMessage = function () {
        // console.log("extracving message ", this.queue);
        // find the first message with alive src and dst.
        var i = this.queue.findIndex(function (m) { return m.src.failed == false && m.dst.failed == false; });
        // console.log("foudn index ", i);
        // if none found, return null.
        if (i == -1)
            return null;
        var message = this.queue[i];
        // remove the message from the queue.
        this.queue.splice(i, 1);
        return message;
    };
    return Network;
}());
var PEvent = /** @class */ (function () {
    function PEvent(t, failingComputers, recoveringComputers, proposer, value) {
        if (failingComputers === void 0) { failingComputers = []; }
        if (proposer === void 0) { proposer = null; }
        if (value === void 0) { value = null; }
        this.t = t;
        this.failingComputers = failingComputers;
        this.recoveringComputers = recoveringComputers;
        this.proposer = proposer;
        this.value = value;
    }
    return PEvent;
}());
var pad = function (number) { return number <= 999 ? ("000" + number).slice(-3) : number; };
var range = function (n) { return Array.from(new Array(n), function (x, i) { return i; }); };
function simulateSystem(numberProposers, numberAcceptors, tmax, configureEvents) {
    /* Initialize Proposer and Acceptor sets, and create an empty network */
    var network = new Network();
    var acceptors = range(numberAcceptors).map(function (i) { return new Acceptor(i, network); });
    var proposers = range(numberProposers).map(function (i) { return new Proposer(i, network, acceptors); });
    var events = configureEvents(acceptors, proposers);
    var _loop_1 = function (t) {
        /* If there are no pending messages or events, we can end the simulation */
        if (network.queueEmpty() && events.length == 0) {
            finishSimulation(proposers, numberAcceptors);
            return { value: void 0 };
        }
        /* Process the event for this tick (if any) */
        var somethingHappened = false;
        var i = events.findIndex(function (e) { return e.t == t; });
        var deliveredMessage = false;
        if (i != -1) {
            var event_1 = events[i];
            events.splice(i, 1);
            event_1.failingComputers.forEach(function (c) {
                c.failed = true;
                console.log(pad(t) + ": ** " + c.name + " FAILS **");
                somethingHappened = true;
            });
            event_1.recoveringComputers.forEach(function (c) {
                c.failed = false;
                console.log(pad(t) + ": ** " + c.name + " RECOVERS **");
                somethingHappened = true;
            });
            // If we start a proposal
            if (event_1.proposer != null && event_1.value != null) {
                /* PROPOSE messages originate from outside the system */
                var proposeMessage = new Message(null, event_1.proposer, MessageType.PROPOSE, event_1.value);
                /* PROPOSE messages bypass the network and are delivered directly to the specified Proposer */
                console.log(pad(t) + ": " + proposeMessage.toString());
                somethingHappened = true;
                deliveredMessage = true;
                event_1.proposer.deliverMessage(proposeMessage);
            }
        }
        // We deliver a message if a PROPOSE message was not delivered.
        if (!deliveredMessage) {
            var message = network.extractMessage();
            if (message != null) {
                message.dst.deliverMessage(message);
                console.log(pad(t) + ": " + message.toString());
                somethingHappened = true;
            }
        }
        if (!somethingHappened)
            console.log(pad(t) + ":");
    };
    /* Step through all the ticks */
    for (var t = 0; t < tmax + 1; t++) {
        var state_1 = _loop_1(t);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    finishSimulation(proposers, numberAcceptors);
}
function finishSimulation(proposers, numberAcceptors) {
    var numberProposers = proposers.length;
    console.log("");
    range(numberProposers).forEach(function (i) {
        var e_1, _a;
        var proposer = proposers[i];
        var reachedConsensus = false;
        try {
            for (var _b = __values(proposer.proposals.values()), _c = _b.next(); !_c.done; _c = _b.next()) {
                var proposal = _c.value;
                if (proposal.accepts.size > numberAcceptors / 2) {
                    console.log(proposer.name + " has reached consensus (proposed " + proposal.value + ", accepted " + proposal.decidedValue + ")");
                    reachedConsensus = true;
                    break;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b["return"])) _a.call(_b);
            }
            finally { if (e_1) throw e_1.error; }
        }
        if (!reachedConsensus)
            console.log(proposer.name + " did not reach consensus");
    });
}
function createEventParser(eventstr) {
    return function (acceptors, proposers) {
        var events = [];
        eventstr.forEach(function (s) {
            var tokens = s.split(" ");
            var time = parseInt(tokens[0]);
            var event = events.find(function (e) { return e.t == time; });
            var type = tokens[1];
            if (type == MessageType.PROPOSE) {
                var proposingComputer = proposers[parseInt(tokens[2]) - 1];
                var value = parseInt(tokens[3]);
                if (event) {
                    event.proposer = proposingComputer;
                    event.value = value;
                }
                else
                    events.push(new PEvent(time, [], [], proposingComputer, value));
            }
            if (type == "FAIL" || type == "RECOVER") {
                var computer = void 0;
                var i = parseInt(tokens[3]) - 1;
                if (tokens[2] == "PROPOSER")
                    computer = proposers[i];
                else if (tokens[2] == "ACCEPTOR")
                    computer = acceptors[i];
                else
                    console.log("ERROR: Expected PROPOSER or ACCEPTOR in the 3rd index for a FAIL or RECOVER event command");
                if (event) {
                    if (type == "FAIL")
                        event.failingComputers.push(computer);
                    else
                        event.recoveringComputers.push(computer);
                }
                else {
                    if (type == "FAIL")
                        events.push(new PEvent(time, [computer], []));
                    else
                        events.push(new PEvent(time, [], [computer]));
                }
            }
        });
        // sort the events by time
        events.sort(function (e1, e2) { return (e1.t - e2.t); });
        return events;
    };
}
var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
var lines = [];
rl.on('line', function (line) {
    lines.push(line);
    var tokens = line.split(' ');
    if (tokens[1] == "END") {
        var firstLine = lines[0].split(" ");
        var numberProposers = parseInt(firstLine[0]);
        var numberAcceptors = parseInt(firstLine[1]);
        var tmax = parseInt(firstLine[2]);
        var eventLines = lines.slice(1);
        simulateSystem(numberProposers, numberAcceptors, tmax, createEventParser(eventLines));
    }
});
