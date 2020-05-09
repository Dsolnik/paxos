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
    // The highest numbered proposal that we sent a PROMISE for.
    highestPromisedNumber: null | number
    // The highest numbered accept message that was sent from this acceptor.
    highestAccepted: null | Message

    constructor(index: number, network: Network) {
        this.name = `A${index + 1}`
        this.failed = false;
        this.network = network;
        this.highestPromisedNumber = null;
        this.highestAccepted = null
    }

    // Respond to a message `m` with value `value` and prior accept message `prior`
    respondToMessage(m: Message, type: MessageType, value: null | number = null, prior: null | Message = null) {
        const msg = new Message(this, m.src, type, value, m.number, prior);
        this.network.queueMessage(msg);
        return msg;
    }

    deliverMessage(m: Message) {
        switch (m.type) {
            case MessageType.PREPARE:
                // This is from the second paper.
                if (!this.highestPromisedNumber || m.number > this.highestPromisedNumber) {
                    const promise = this.respondToMessage(m, MessageType.PROMISE, null, this.highestAccepted);
                    this.highestPromisedNumber = promise.number;
                }
                break;
            case MessageType.ACCEPT:
                // This is from the second paper.
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

    // Sends a message to all acceptors.
    sendToAllAcceptors(type: MessageType, value: null | number, number: null | number) {
        this.acceptors.forEach(a => this.network.queueMessage(new Message(this, a, type, value, number)))
    }

    // Start a new proposal with default value `value`.
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
                        throw new Error(`invalid proposal number in PROMISE ${m.toString()}`)

                    proposal.promises.set(<Acceptor>m.src, m);
                    // If the proposer receives a response to its prepare requests
                    // (numbered n) from a majority of acceptors, we send out ACCEPTs.
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
                        throw new Error(`invalid proposal number in ACCEPTED ${m.toString()}`)

                    proposal.accepts.add(<Acceptor>m.src);
                    break;
                }
            case MessageType.REJECTED:
                {
                    const proposal = this.proposals.get(m.number);
                    if (!proposal)
                        throw new Error(`invalid proposal number in REJECTED ${m.toString()}`)

                    proposal.rejects.add(<Acceptor>m.src);
                    // Start a new proposal if got a majority of rejects.
                    if (proposal.rejects.size > this.acceptors.length / 2 && !proposal.restarted) {
                        proposal.restarted = true;
                        this.startProposal(proposal.value);
                    }
                    break;
                }
            default:
                throw new Error(`${m.type} not handled`);
        }

    }
}

// A proposal in the synod. 
class Proposal {
    number: number
    // The initial value, the value used if no priors recieved.
    value: number
    // The value decided upon after recieving a quorum of promises and taking the largest value.
    decidedValue: number

    // We keep the message for each acceptor incase they already accepted one. Then, we need to use their previous to abide by B3.
    promises: Map<Acceptor, Message> = new Map<Acceptor, Message>()
    accepts: Set<Acceptor> = new Set<Acceptor>()
    rejects: Set<Acceptor> = new Set<Acceptor>()

    // If we got a majority of rejects, we restart the proposal and create a new one.
    restarted: boolean = false
    // If we got a majority of promises, we send out ACCEPTs.
    sentAccept: boolean = false

    constructor(value: number, number: number) {
        this.value = value;
        this.decidedValue = value;
        this.number = number;
    }

    // Calculate the value to send in ACCEPT to each acceptor.
    // We take the prior value of the highest numbered previously sent accept.
    //  If no machine who promised has accepted yet, we use the defaultValue (`value`)
    getValueToSend() {
        let priorValue: null | number = null;
        let priorNumber: number = -1;
        [...this.promises.values()].forEach(m => {
            if (m.prior && m.prior.number > priorNumber) {
                priorValue = m.prior.value;
                priorNumber = m.prior.number;
            }
        })
        this.decidedValue = priorValue || this.value;
        return this.decidedValue;
    }
}

enum MessageType {
    PROPOSE = "PROPOSE", PREPARE = "PREPARE", PROMISE = "PROMISE", ACCEPT = "ACCEPT", ACCEPTED = "ACCEPTED", REJECTED = "REJECTED"
}

// A message sent over the network.
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
    
    // Send a message.
    queueMessage(m: Message) {
        this.queue.push(m);
    }

    // Check if there are any messages still on the network.
    queueEmpty() {
        return this.queue.length == 0;
    }

    // Remove a message to deliver if possible.
    extractMessage(): null | Message {
        // find the first message with alive src machine and dst machine.
        const i = this.queue.findIndex(m => m.src.failed == false && m.dst.failed == false)
        // if none found, return null.
        if (i == -1)
            return null;

        const message = this.queue[i];
        // remove the message from the queue.
        this.queue.splice(i, 1);
        return message;
    }
}

// An event.
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
        let printedSomething = false;
        // Find the event for the time.
        const i = events.findIndex(e => e.t == t);
        // If we delivered a message to a computer.
        let deliveredMessage = false;
        // If an event has this time.
        if (i != -1) {
            const event = events[i];
            events.splice(i, 1);
            // Fail all the computers.
            event.failingComputers.forEach(c => {
                c.failed = true;

                console.log(`${pad(t)}:  ** ${c.name} FAILS **`);
                printedSomething = true;
            });

            // Recover all the computers.
            event.recoveringComputers.forEach(c => {
                c.failed = false;

                console.log(`${pad(t)}:  ** ${c.name} RECOVERS **`);
                printedSomething = true;
            });

            // If we start a proposal.
            if (event.proposer != null && event.value != null) {
                /* PROPOSE messages originate from outside the system */
                const proposeMessage = new Message(null, event.proposer, MessageType.PROPOSE, event.value);
                /* PROPOSE messages bypass the network and are delivered directly to the specified Proposer */
                console.log(`${pad(t)}: ${proposeMessage.toString()}`)
                printedSomething = true;
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
                printedSomething = true;
            }
        }
        // If nothing was outputted, we output a blank line.
        if (!printedSomething)
            console.log(`${pad(t)}:`)
    }
    finishSimulation(proposers, numberAcceptors);
}

// Print out whether each proposer reached consensus.
function finishSimulation(proposers: Proposer[], numberAcceptors: number) {
    const numberProposers = proposers.length;
    console.log("")
    range(numberProposers).forEach(i => {
        const proposer = proposers[i];
        for (let proposal of proposer.proposals.values()) {
            if (proposal.accepts.size > numberAcceptors / 2) {
                console.log(`${proposer.name} has reached consensus (proposed ${proposal.value}, accepted ${proposal.decidedValue})`)
                return;
            }
        }
        console.log(`${proposer.name} did not reach consensus`)
    })
}

// Given a list of events, returns a function that creates events when given the list of acceptors and proposers.
function createEventParser(eventstr: string[]): (acceptors: Acceptor[], proposers: Proposer[]) => PEvent[] {
    return (acceptors, proposers) => {
        let events: PEvent[] = [];
        eventstr.forEach(s => {
            const tokens = s.split(" ");
            const time = parseInt(tokens[0]);
            let event = events.find(e => e.t == time);
            // Create a new event if we aren't just adding to one.
            if (!event) {
                event = new PEvent(time, [], []);
                events.push(event);
            }

            const type = tokens[1];
            if (type == MessageType.PROPOSE) {
                const proposingComputer = proposers[parseInt(tokens[2]) - 1];
                const value = parseInt(tokens[3]);
                event.proposer = proposingComputer;
                event.value = value;
            }

            if (type == "FAIL" || type == "RECOVER") {
                let computer: Computer;
                const i = parseInt(tokens[3]) - 1;
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
        })
        // We don't need to sort the events by time because we search through the events list when using events.
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
    if (tokens[0] == "0" && tokens[1] == "END") {
        const firstLine = lines[0].split(" ");
        const numberProposers = parseInt(firstLine[0]);
        const numberAcceptors = parseInt(firstLine[1]);
        const tmax = parseInt(firstLine[2]);
        const eventLines = lines.slice(1);
        simulateSystem(numberProposers, numberAcceptors, tmax, createEventParser(eventLines))
    }
});