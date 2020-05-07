import * as readline from "readline"

interface Computer {
    name: string
    failed: boolean
    deliverMessage(m: Message): void
}

class Acceptor implements Computer {
    name: string
    failed: boolean
    network: Network
    highestPromisedNumber: null | number
    highestAccepted: null | Message
    constructor(index: number, network: Network) {
        this.name = `A${index + 1}`
        this.failed = false;
        this.network = network;
        this.highestPromisedNumber = null;
        this.highestAccepted = null
    }

    respondToMessage(m: Message, type: MessageType, value: null | number = null, prior: null | Message = null) {
        const msg = new Message(this, m.src, type, value, m.number, prior);
        this.network.queueMessage(msg);
        return msg;
    }

    deliverMessage(m: Message) {
        switch (m.type) {
            case MessageType.PREPARE:
                if (!this.highestPromisedNumber || m.number > this.highestPromisedNumber) {
                    const promise = this.respondToMessage(m, MessageType.PROMISE, null, this.highestAccepted);
                    this.highestPromisedNumber = promise.number;
                }
                break;
            case MessageType.ACCEPT:
                if (this.highestPromisedNumber && m.number < this.highestPromisedNumber)
                    this.respondToMessage(m, MessageType.REJECTED);
                else {
                    const acceptMsg = this.respondToMessage(m, MessageType.ACCEPTED, m.value);
                    if (!this.highestAccepted || m.number > this.highestAccepted.number)
                        this.highestAccepted = acceptMsg;
                }
        }
    }
}


class Proposal {
    number: number
    value: number
    decidedValue: number

    promises: Map<Acceptor, Message> = new Map<Acceptor, Message>()
    accepts: Set<Acceptor> = new Set<Acceptor>()
    rejects: Set<Acceptor> = new Set<Acceptor>()
    restarted: boolean = false
    sentAccept: boolean = false

    constructor(value: number, number: number) {
        this.value = value;
        this.decidedValue = value;
        this.number = number;
    }

    getValueToSend() {
        let priorValue: null | number = null;
        let priorNumber: number = -1;
        [...this.promises.values()].forEach(m => {
            if (m.prior && m.prior.number > priorNumber) {
                priorValue = m.prior.value;
                priorNumber = m.prior.number;
            }
        })
        this.decidedValue = priorValue ? priorValue : this.value;
        return this.decidedValue;
    }
}

class Proposer implements Computer {

    static proposalNumber = 1
    static getProposalNumber = () => {
        return Proposer.proposalNumber++;
    };

    name: string
    failed: boolean
    acceptors: Acceptor[]
    network: Network
    proposals: Map<number, Proposal>
    constructor(index: number, network: Network, acceptors: Acceptor[]) {
        this.name = `P${index + 1}`
        this.failed = false;
        this.network = network;
        this.acceptors = acceptors;
        this.proposals = new Map<number, Proposal>();
    }

    sendToAllAcceptors(type: MessageType, value: null | number, number: null | number) {
        this.acceptors.forEach(a => this.network.queueMessage(new Message(this, a, type, value, number)))
    }

    startProposal(value: number) {
        const pNum = Proposer.getProposalNumber();
        this.sendToAllAcceptors(MessageType.PREPARE, null, pNum);
        this.proposals.set(pNum, new Proposal(value, pNum))
    }

    deliverMessage(m: Message) {
        switch (m.type) {
            case MessageType.PROPOSE:
                {
                    // A proposer selects a proposal number n and sends a prepare
                    // request with number n to a majority of acceptors.
                    this.startProposal(m.value)
                    break;
                }
            case MessageType.PROMISE:
                {
                    const proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in PROMISE ", m)

                    proposal.promises.set(<Acceptor>m.src, m);
                    // If the proposer receives a response to its prepare requests
                    // (numbered n) from a majority of acceptors,
                    // get the latest proposal
                    if (proposal.promises.size > this.acceptors.length / 2 && !proposal.sentAccept) {
                        this.sendToAllAcceptors(MessageType.ACCEPT, proposal.getValueToSend(), proposal.number)
                        proposal.sentAccept = true;
                    }
                    break;
                }
            case MessageType.ACCEPTED:
                {
                    const proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in ACCEPTED ", m)

                    proposal.accepts.add(<Acceptor>m.src);
                    break;
                }
            case MessageType.REJECTED:
                {
                    const proposal = this.proposals.get(m.number);
                    if (!proposal)
                        return console.log("invalid proposal number in ACCEPTED ", m)

                    proposal.rejects.add(<Acceptor>m.src);
                    if (proposal.rejects.size > this.acceptors.length / 2 && !proposal.restarted) {
                        proposal.restarted = true;
                        this.startProposal(proposal.value);
                    }
                    break;
                }
            default:
                console.log(m.type, " not handled");
        }

    }
}

enum MessageType {
    PROPOSE = "PROPOSE", PREPARE = "PREPARE", PROMISE = "PROMISE", ACCEPT = "ACCEPT", ACCEPTED = "ACCEPTED", REJECTED = "REJECTED"
}

class Message {
    src: null | Computer
    dst: Computer
    type: MessageType
    value: null | number
    number: null | number
    prior: null | Message
    constructor(src: null | Computer, dst: Computer, type: MessageType, value: null | number = null, number: null | number = null, prior: null | Message = null) {
        this.src = src;
        this.dst = dst;
        this.type = type;
        this.value = value;
        this.number = number;
        this.prior = prior;
    }
    toString() {
        let toReturn = `${this.src != null ? this.src.name : "  "} -> ${this.dst.name}  ${this.type}`;

        if (this.number)
            toReturn += ` n=${this.number}`
        if (this.value)
            toReturn += ` v=${this.value}`
        if (this.type === MessageType.PROMISE)
            toReturn += ` (Prior: ${this.prior != null ? `n=${this.prior.number}, v=${this.prior.value}` : "None"})`;
        return toReturn;
    }
}

class Network {
    queue: Message[]
    name: string
    constructor() {
        this.queue = [];
    }

    queueMessage(m: Message) {
        this.queue.push(m);
    }

    queueEmpty() {
        return this.queue.length == 0;
    }

    extractMessage(): null | Message {
        // console.log("extracving message ", this.queue);
        // find the first message with alive src and dst.
        const i = this.queue.findIndex(m => m.src.failed == false && m.dst.failed == false)
        // console.log("foudn index ", i);
        // if none found, return null.
        if (i == -1)
            return null;

        const message = this.queue[i];
        // remove the message from the queue.
        this.queue.splice(i, 1);
        return message;
    }
}

class PEvent {
    t: number
    failingComputers: Computer[]
    recoveringComputers: Computer[]
    proposer: null | Computer
    value: null | number
    constructor(t: number,
        failingComputers: Computer[] = [],
        recoveringComputers: Computer[],
        proposer: null | Computer = null,
        value: null | number = null) {
        this.t = t;
        this.failingComputers = failingComputers;
        this.recoveringComputers = recoveringComputers;
        this.proposer = proposer;
        this.value = value;
    }
}

const pad = (number: number) => number <= 999 ? `000${number}`.slice(-3) : number;
const range = (n: number): number[] => Array.from(new Array(n), (x, i) => i);

function simulateSystem(numberProposers: number, numberAcceptors: number, tmax: number, configureEvents: (acceptors: Acceptor[], proposers: Proposer[]) => PEvent[]) {
    /* Initialize Proposer and Acceptor sets, and create an empty network */
    const network = new Network();
    const acceptors = range(numberAcceptors).map(i => new Acceptor(i, network));
    const proposers = range(numberProposers).map(i => new Proposer(i, network, acceptors));
    const events = configureEvents(acceptors, proposers);

    /* Step through all the ticks */
    for (let t = 0; t < tmax + 1; t++) {
        /* If there are no pending messages or events, we can end the simulation */
        if (network.queueEmpty() && events.length == 0) {
            finishSimulation(proposers, numberAcceptors);
            return;
        }

        /* Process the event for this tick (if any) */
        let somethingHappened = false;
        const i = events.findIndex(e => e.t == t);
        let deliveredMessage = false;
        if (i != -1) {
            const event = events[i];
            events.splice(i, 1);
            event.failingComputers.forEach(c => {
                c.failed = true;

                console.log(`${pad(t)}: ** ${c.name} FAILS **`);
                somethingHappened = true;
            });
            event.recoveringComputers.forEach(c => {
                c.failed = false;

                console.log(`${pad(t)}: ** ${c.name} RECOVERS **`);
                somethingHappened = true;
            });

            // If we start a proposal
            if (event.proposer != null && event.value != null) {
                /* PROPOSE messages originate from outside the system */
                const proposeMessage = new Message(null, event.proposer, MessageType.PROPOSE, event.value);
                /* PROPOSE messages bypass the network and are delivered directly to the specified Proposer */
                console.log(`${pad(t)}: ${proposeMessage.toString()}`)
                somethingHappened = true;
                deliveredMessage = true;
                event.proposer.deliverMessage(proposeMessage);
            }
        }

        // We deliver a message if a PROPOSE message was not delivered.
        if (!deliveredMessage) {
            const message = network.extractMessage();
            if (message != null) {
                message.dst.deliverMessage(message);

                console.log(`${pad(t)}: ${message.toString()}`)
                somethingHappened = true;
            }
        }
        if (!somethingHappened)
            console.log(`${pad(t)}:`)
    }
    finishSimulation(proposers, numberAcceptors);
}

function finishSimulation(proposers: Proposer[], numberAcceptors: number) {
    const numberProposers = proposers.length;
    console.log("")
    range(numberProposers).forEach(i => {
        const proposer = proposers[i];
        let reachedConsensus = false
        for (let proposal of proposer.proposals.values()) {
            if (proposal.accepts.size > numberAcceptors / 2) {
                console.log(`${proposer.name} has reached consensus (proposed ${proposal.value}, accepted ${proposal.decidedValue})`)
                reachedConsensus = true
                break
            }
        }
        if (!reachedConsensus)
            console.log(`${proposer.name} did not reach consensus`)
    })
}

function createEventParser(eventstr: string[]): (acceptors: Acceptor[], proposers: Proposer[]) => PEvent[] {
    return (acceptors, proposers) => {
        let events: PEvent[] = [];
        eventstr.forEach(s => {
            const tokens = s.split(" ");
            const time = parseInt(tokens[0]);
            const event = events.find(e => e.t == time);

            const type = tokens[1];
            if (type == MessageType.PROPOSE) {
                const proposingComputer = proposers[parseInt(tokens[2]) - 1];
                const value = parseInt(tokens[3]);
                if (event) {
                    event.proposer = proposingComputer;
                    event.value = value;
                } else
                    events.push(new PEvent(time, [], [], proposingComputer, value));
            }

            if (type == "FAIL" || type == "RECOVER") {
                let computer: Computer;
                const i = parseInt(tokens[3]) - 1;
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
                } else {
                    if (type == "FAIL")
                        events.push(new PEvent(time, [computer], []))
                    else
                        events.push(new PEvent(time, [], [computer]))
                }
            }
        })
        // sort the events by time
        events.sort((e1, e2) => (e1.t - e2.t));
        return events;
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let lines: string[] = [];

rl.on('line', (line) => {
    lines.push(line);
    let tokens = line.split(' ');
    if (tokens[1] == "END") {
        const firstLine = lines[0].split(" ");
        const numberProposers = parseInt(firstLine[0]);
        const numberAcceptors = parseInt(firstLine[1]);
        const tmax = parseInt(firstLine[2]);
        const eventLines = lines.slice(1);
        simulateSystem(numberProposers, numberAcceptors, tmax, createEventParser(eventLines))
    }
});
