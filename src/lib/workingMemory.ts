// working memory class object 
interface WorkingMemoryData{ 
	userInfo: Record<string, unknown>, 
	goals: string[]; 
	topics: string[] 
} 
interface WorkingMemoryDiff {
  userInfo?: Record<string, unknown>;  // shallow-merged into this.userInfo
  addGoals?: string[];                 // new goals to append (deduped)
  removeGoals?: string[];              // goals to drop (task completed / abandoned)
  addTopics?: string[];                // brand-new topics
  reinforceTopics?: string[];          // existing topics mentioned again this turn
}
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
    applyDiff(diff: WorkingMemoryDiff): void {
        if (diff.userInfo) {
            this.userInfo = { ...this.userInfo, ...diff.userInfo };
        }
        if (diff.removeGoals?.length) {
            this.goals = this.goals.filter(g => !diff.removeGoals!.includes(g));
        }
        if (diff.addGoals?.length) {
            const newOnes = diff.addGoals.filter(g => !this.goals.includes(g));
            this.goals.unshift(...newOnes);   // new goals start at the front
        }
        if (diff.addTopics?.length) {
            const newOnes = diff.addTopics.filter(t => !this.topics.includes(t));
            this.topics.unshift(...newOnes);
        }
        if (diff.reinforceTopics?.length) {
            this.reinforceTopics(diff.reinforceTopics);
        }
    }
    // - reranking the arrays so recent items are indexed sooner/lower 
    reinforceTopics(mentioned: string[]): void {
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