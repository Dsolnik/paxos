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
    // Respond to a message `m` with value `value` and prior accept message `prior`
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
                // This is from the second paper.
                if (!this.highestPromisedNumber || m.number > this.highestPromisedNumber) {
                    var promise = this.respondToMessage(m, MessageType.PROMISE, null, this.highestAccepted);
                    this.highestPromisedNumber = promise.number;
                }
                break;
            case MessageType.ACCEPT:
                // This is from the second paper.
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
var Proposer = /** @class */ (function () {
    function Proposer(index, network, acceptors) {
        this.name = "P" + (index + 1);
        this.failed = false;
        this.network = network;
        this.acceptors = acceptors;
        this.proposals = new Map();
    }
    // Sends a message to all acceptors.
    Proposer.prototype.sendToAllAcceptors = function (type, value, number) {
        var _this = this;
        this.acceptors.forEach(function (a) { return _this.network.queueMessage(new Message(_this, a, type, value, number)); });
    };
    // Start a new proposal with default value `value`.
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
                        throw new Error("invalid proposal number in PROMISE " + m.toString());
                    proposal.promises.set(m.src, m);
                    // If the proposer receives a response to its prepare requests
                    // (numbered n) from a majority of acceptors, we send out ACCEPTs.
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
                        throw new Error("invalid proposal number in ACCEPTED " + m.toString());
                    proposal.accepts.add(m.src);
                    break;
                }
            case MessageType.REJECTED:
                {
                    var proposal = this.proposals.get(m.number);
                    if (!proposal)
                        throw new Error("invalid proposal number in REJECTED " + m.toString());
                    proposal.rejects.add(m.src);
                    // Start a new proposal if got a majority of rejects.
                    if (proposal.rejects.size > this.acceptors.length / 2 && !proposal.restarted) {
                        proposal.restarted = true;
                        this.startProposal(proposal.value);
                    }
                    break;
                }
            default:
                throw new Error(m.type + " not handled");
        }
    };
    Proposer.proposalNumber = 1;
    Proposer.getProposalNumber = function () {
        return Proposer.proposalNumber++;
    };
    return Proposer;
}());
// A proposal in the synod. 
var Proposal = /** @class */ (function () {
    function Proposal(value, number) {
        // We keep the message for each acceptor incase they already accepted one. Then, we need to use their previous to abide by B3.
        this.promises = new Map();
        this.accepts = new Set();
        this.rejects = new Set();
        // If we got a majority of rejects, we restart the proposal and create a new one.
        this.restarted = false;
        // If we got a majority of promises, we send out ACCEPTs.
        this.sentAccept = false;
        this.value = value;
        this.decidedValue = value;
        this.number = number;
    }
    // Calculate the value to send in ACCEPT to each acceptor.
    // We take the prior value of the highest numbered previously sent accept.
    //  If no machine who promised has accepted yet, we use the defaultValue (`value`)
    Proposal.prototype.getValueToSend = function () {
        var priorValue = null;
        var priorNumber = -1;
        __spread(this.promises.values()).forEach(function (m) {
            if (m.prior && m.prior.number > priorNumber) {
                priorValue = m.prior.value;
                priorNumber = m.prior.number;
            }
        });
        this.decidedValue = priorValue || this.value;
        return this.decidedValue;
    };
    return Proposal;
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
// A message sent over the network.
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
    // Send a message.
    Network.prototype.queueMessage = function (m) {
        this.queue.push(m);
    };
    // Check if there are any messages still on the network.
    Network.prototype.queueEmpty = function () {
        return this.queue.length == 0;
    };
    // Remove a message to deliver if possible.
    Network.prototype.extractMessage = function () {
        // find the first message with alive src machine and dst machine.
        var i = this.queue.findIndex(function (m) { return m.src.failed == false && m.dst.failed == false; });
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
// An event.
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
        var printedSomething = false;
        // Find the event for the time.
        var i = events.findIndex(function (e) { return e.t == t; });
        // If we delivered a message to a computer.
        var deliveredMessage = false;
        // If an event has this time.
        if (i != -1) {
            var event_1 = events[i];
            events.splice(i, 1);
            // Fail all the computers.
            event_1.failingComputers.forEach(function (c) {
                c.failed = true;
                console.log(pad(t) + ":  ** " + c.name + " FAILS **");
                printedSomething = true;
            });
            // Recover all the computers.
            event_1.recoveringComputers.forEach(function (c) {
                c.failed = false;
                console.log(pad(t) + ":  ** " + c.name + " RECOVERS **");
                printedSomething = true;
            });
            // If we start a proposal.
            if (event_1.proposer != null && event_1.value != null) {
                /* PROPOSE messages originate from outside the system */
                var proposeMessage = new Message(null, event_1.proposer, MessageType.PROPOSE, event_1.value);
                /* PROPOSE messages bypass the network and are delivered directly to the specified Proposer */
                console.log(pad(t) + ": " + proposeMessage.toString());
                printedSomething = true;
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
                printedSomething = true;
            }
        }
        // If nothing was outputted, we output a blank line.
        if (!printedSomething)
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
// Print out whether each proposer reached consensus.
function finishSimulation(proposers, numberAcceptors) {
    var numberProposers = proposers.length;
    console.log("");
    range(numberProposers).forEach(function (i) {
        var e_1, _a;
        var proposer = proposers[i];
        try {
            for (var _b = __values(proposer.proposals.values()), _c = _b.next(); !_c.done; _c = _b.next()) {
                var proposal = _c.value;
                if (proposal.accepts.size > numberAcceptors / 2) {
                    console.log(proposer.name + " has reached consensus (proposed " + proposal.value + ", accepted " + proposal.decidedValue + ")");
                    return;
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
        console.log(proposer.name + " did not reach consensus");
    });
}
// Given a list of events, returns a function that creates events when given the list of acceptors and proposers.
function createEventParser(eventstr) {
    return function (acceptors, proposers) {
        var events = [];
        eventstr.forEach(function (s) {
            var tokens = s.split(" ");
            var time = parseInt(tokens[0]);
            var event = events.find(function (e) { return e.t == time; });
            // Create a new event if we aren't just adding to one.
            if (!event) {
                event = new PEvent(time, [], []);
                events.push(event);
            }
            var type = tokens[1];
            if (type == MessageType.PROPOSE) {
                var proposingComputer = proposers[parseInt(tokens[2]) - 1];
                var value = parseInt(tokens[3]);
                event.proposer = proposingComputer;
                event.value = value;
            }
            if (type == "FAIL" || type == "RECOVER") {
                var computer = void 0;
                var i = parseInt(tokens[3]) - 1;
                // Select the appropriate computer.
                if (tokens[2] == "PROPOSER")
                    computer = proposers[i];
                else if (tokens[2] == "ACCEPTOR")
                    computer = acceptors[i];
                else
                    throw new Error("ERROR: Expected PROPOSER or ACCEPTOR in the 3rd index for a FAIL or RECOVER event command");
                // Add the fail or the recovery.
                if (type == "FAIL")
                    event.failingComputers.push(computer);
                else
                    event.recoveringComputers.push(computer);
            }
        });
        // We don't need to sort the events by time because we search through the events list when using events.
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
    if (tokens[0] == "0" && tokens[1] == "END") {
        var firstLine = lines[0].split(" ");
        var numberProposers = parseInt(firstLine[0]);
        var numberAcceptors = parseInt(firstLine[1]);
        var tmax = parseInt(firstLine[2]);
        var eventLines = lines.slice(1);
        simulateSystem(numberProposers, numberAcceptors, tmax, createEventParser(eventLines));
    }
});
