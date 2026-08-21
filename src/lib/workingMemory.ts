// working memory class object 
interface WorkingMemoryData{ 
	userInfo: Record<string, unknown>, 
	goals: string[]; 
	topics: string[] 
} 
export interface WorkingMemoryDelta {
  userInfo?: Record<string, unknown>;  // shallow-merged into this.userInfo
  addGoals?: string[];                 // new goals to append (deduped)
//   removeGoals?: string[];              // goals to drop (task completed / abandoned)
  addTopics?: string[];                // brand-new topics
  reinforceTopics?: string[];          // existing topics mentioned again this turn
  reinforceGoals?: string[];           // existing goals mentioned again this turn

  // TODO: leaving removeGoals for later to be implemented together with a completed gaols property.
  // considering dropping topics/goals after a certain number, but I dont really like the idea of doing this.
  // STRONGLY CONSIDERING: a motivation/ affect property with instructions on how to proceed. could be a simple feature like mood valence -1 to 1, magnitude 0 to 10
}

export const workingMemoryDeltaSchema = {
  type: "object",
  properties: {
    userInfo: { type: "object" },
    addGoals: { type: "array", items: { type: "string" } },
    addTopics: { type: "array", items: { type: "string" } },
    reinforceTopics: { type: "array", items: { type: "string" } },
    reinforceGoals: { type: "array", items: { type: "string" } },
  },
}; // this object is passed as guided_json constraints so that the LLM returns this data shape

export class WorkingMemory { 
	userInfo: Record<string, unknown>; 
	goals: string[]; 
	topics: string[]; 
	
	constructor({userInfo={}, goals=[], topics=[]}: Partial<WorkingMemoryData>={}){ 
		this.userInfo = userInfo; 
		this.goals = goals; 
		this.topics = topics; 
	}

    //still need methods for updating values 
    // - adding diffs to values, 
    applyDelta(delta: WorkingMemoryDelta): void {
        if (delta.userInfo) {
            this.userInfo = { ...this.userInfo, ...delta.userInfo };
        }
        // if (delta.removeGoals?.length) {
        //     this.goals = this.goals.filter(g => !delta.removeGoals!.includes(g));
        // }
        if (delta.addGoals?.length) {
            const newOnes = delta.addGoals.filter(g => !this.goals.includes(g));
            this.goals.unshift(...newOnes);   // new goals start at the front
        }
        if (delta.addTopics?.length) {
            const newOnes = delta.addTopics.filter(t => !this.topics.includes(t));
            this.topics.unshift(...newOnes);
        }
        if (delta.reinforceGoals?.length) {
            this.reRankGoals(delta.reinforceGoals);
        }
        if (delta.reinforceTopics?.length) {
            this.reRankTopics(delta.reinforceTopics);
        }
    }
    // - reranking the arrays so recent items are indexed sooner/lower 
    reRankGoals(mentioned: string[]): void {
        for (const goal of mentioned) {
            const idx = this.goals.indexOf(goal);
            if (idx > 0) {                          // already at 0 → nothing to do
                this.goals.splice(idx, 1);           // remove from old position
                this.goals.unshift(goal);           // move to front
        }
    }
    }
    
    reRankTopics(mentioned: string[]): void {
        for (const topic of mentioned) {
            const idx = this.topics.indexOf(topic);
            if (idx > 0) {                          // already at 0 → nothing to do
                this.topics.splice(idx, 1);           // remove from old position
                this.topics.unshift(topic);           // move to front
        }
    }
    }

    
	toJSON(): WorkingMemoryData { 
	return {userInfo: this.userInfo, topics: this.topics, goals: this.goals}; } 
}


// TODO: methods to clean up accumulating information. 