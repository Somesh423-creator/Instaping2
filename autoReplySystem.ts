
export interface PlanLimits {
  dailyReplies: number;
  maxKeywords: number;
  responseDelay: number;
  analyticsRetention: number;
  apiAccess: boolean;
  prioritySupport: boolean;
}

export interface AutoReplyConfig {
  enabled: boolean;
  workingHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  responseDelay: number;
  rateLimiting: {
    enabled: boolean;
    maxPerMinute: number;
    maxPerHour: number;
  };
}

export interface UserStats {
  dailyRepliesUsed: number;
  monthlyRepliesUsed: number;
  keywordsUsed: number;
  lastReplyTime: string;
  quotaResetTime: string;
}

export class AutoReplySystem {
  private static instance: AutoReplySystem;
  private planLimits: Record<string, PlanLimits> = {
    free: {
      dailyReplies: 5,
      maxKeywords: 2,
      responseDelay: 0,
      analyticsRetention: 7,
      apiAccess: false,
      prioritySupport: false
    },
    pro: {
      dailyReplies: 2000,
      maxKeywords: 20,
      responseDelay: 0,
      analyticsRetention: 30,
      apiAccess: false,
      prioritySupport: true
    },
    advanced: {
      dailyReplies: -1, // unlimited
      maxKeywords: -1, // unlimited
      responseDelay: 0,
      analyticsRetention: 90,
      apiAccess: true,
      prioritySupport: true
    }
  };

  static getInstance(): AutoReplySystem {
    if (!AutoReplySystem.instance) {
      AutoReplySystem.instance = new AutoReplySystem();
    }
    return AutoReplySystem.instance;
  }

  getPlanLimits(plan: string): PlanLimits {
    return this.planLimits[plan] || this.planLimits.free;
  }

  canSendAutoReply(userPlan: string, userStats: UserStats): { canSend: boolean; reason?: string } {
    const limits = this.getPlanLimits(userPlan);

    // Check daily reply limit
    if (limits.dailyReplies !== -1 && userStats.dailyRepliesUsed >= limits.dailyReplies) {
      return { canSend: false, reason: 'Daily reply limit exceeded' };
    }

    // Check if quota reset is needed
    const now = new Date();
    const resetTime = new Date(userStats.quotaResetTime);
    if (now > resetTime) {
      // Reset daily counters
      userStats.dailyRepliesUsed = 0;
      userStats.quotaResetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    return { canSend: true };
  }

  async processAutoReply(
    userId: string,
    userPlan: string,
    keyword: string,
    message: string,
    sender: string
  ): Promise<{ success: boolean; reply?: string; error?: string }> {
    try {
      // Get user stats
      const userStats = this.getUserStats(userId);

      // Check if user can send auto-reply
      const canSend = this.canSendAutoReply(userPlan, userStats);
      if (!canSend.canSend) {
        return { success: false, error: canSend.reason };
      }

      // Get keyword configuration
      const keywordConfig = this.getKeywordConfig(userId, keyword);
      if (!keywordConfig) {
        return { success: false, error: 'Keyword not found' };
      }

      // Check working hours
      if (!this.isWithinWorkingHours(userId)) {
        return { success: false, error: 'Outside working hours' };
      }

      // Apply response delay
      const delay = this.getResponseDelay(userPlan, keywordConfig.delay);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }

      // Generate auto-reply
      const reply = this.generateAutoReply(keywordConfig, message, sender);

      // Update user stats
      this.updateUserStats(userId, userStats);

      // Log the interaction
      this.logAutoReply(userId, keyword, message, reply, sender);

      return { success: true, reply };
    } catch (error) {
      console.error('Auto-reply processing error:', error);
      return { success: false, error: 'Internal processing error' };
    }
  }

  private getUserStats(userId: string): UserStats {
    const stored = localStorage.getItem(`userStats_${userId}`);
    const now = new Date();
    const defaultStats: UserStats = {
      dailyRepliesUsed: 0,
      monthlyRepliesUsed: 0,
      keywordsUsed: 0,
      lastReplyTime: now.toISOString(),
      quotaResetTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    };

    return stored ? { ...defaultStats, ...JSON.parse(stored) } : defaultStats;
  }

  private getKeywordConfig(userId: string, keyword: string): any {
    const keywords = JSON.parse(localStorage.getItem(`keywords_${userId}`) || '[]');
    return keywords.find((k: any) => k.keyword.toLowerCase() === keyword.toLowerCase() && k.active);
  }

  private isWithinWorkingHours(userId: string): boolean {
    const settings = JSON.parse(localStorage.getItem(`userSettings_${userId}`) || '{}');
    const autoReplySettings = settings.autoReply || { workingHours: false };

    if (!autoReplySettings.workingHours) return true;

    const now = new Date();
    const currentHour = now.getHours();
    const startHour = parseInt(autoReplySettings.startTime?.split(':')[0] || '0');
    const endHour = parseInt(autoReplySettings.endTime?.split(':')[0] || '23');

    return currentHour >= startHour && currentHour <= endHour;
  }

  private getResponseDelay(userPlan: string, keywordDelay?: number): number {
    const planLimits = this.getPlanLimits(userPlan);
    return keywordDelay || planLimits.responseDelay;
  }

  private generateAutoReply(keywordConfig: any, message: string, sender: string): string {
    let reply = keywordConfig.reply;

    // Replace placeholders
    reply = reply.replace(/{sender}/g, sender);
    reply = reply.replace(/{time}/g, new Date().toLocaleTimeString());
    reply = reply.replace(/{date}/g, new Date().toLocaleDateString());

    return reply;
  }

  private updateUserStats(userId: string, stats: UserStats): void {
    stats.dailyRepliesUsed++;
    stats.monthlyRepliesUsed++;
    stats.lastReplyTime = new Date().toISOString();

    localStorage.setItem(`userStats_${userId}`, JSON.stringify(stats));
  }

  private logAutoReply(userId: string, keyword: string, message: string, reply: string, sender: string): void {
    const logs = JSON.parse(localStorage.getItem(`autoReplyLogs_${userId}`) || '[]');
    logs.unshift({
      id: Date.now(),
      keyword,
      message,
      reply,
      sender,
      timestamp: new Date().toISOString(),
      status: 'sent'
    });

    // Keep only last 100 logs
    if (logs.length > 100) {
      logs.splice(100);
    }

    localStorage.setItem(`autoReplyLogs_${userId}`, JSON.stringify(logs));
  }

  getUsageAnalytics(userId: string, userPlan: string): any {
    const stats = this.getUserStats(userId);
    const limits = this.getPlanLimits(userPlan);
    const logs = JSON.parse(localStorage.getItem(`autoReplyLogs_${userId}`) || '[]');

    return {
      dailyUsage: {
        used: stats.dailyRepliesUsed,
        limit: limits.dailyReplies,
        percentage: limits.dailyReplies === -1 ? 0 : (stats.dailyRepliesUsed / limits.dailyReplies) * 100
      },
      monthlyUsage: {
        used: stats.monthlyRepliesUsed,
        limit: limits.dailyReplies === -1 ? -1 : limits.dailyReplies * 30
      },
      keywordUsage: {
        used: stats.keywordsUsed,
        limit: limits.maxKeywords,
        percentage: limits.maxKeywords === -1 ? 0 : (stats.keywordsUsed / limits.maxKeywords) * 100
      },
      recentActivity: logs.slice(0, 10),
      performance: {
        totalReplies: logs.length,
        successRate: (logs.filter((log: any) => log.status === 'sent').length / logs.length) * 100,
        avgResponseTime: 0.3
      }
    };
  }

  shouldShowUpgradePrompt(userId: string, userPlan: string): { show: boolean; reason?: string } {
    const stats = this.getUserStats(userId);
    const limits = this.getPlanLimits(userPlan);

    if (userPlan === 'free') {
      // Show upgrade prompt when approaching limits
      if (stats.dailyRepliesUsed >= limits.dailyReplies * 0.8) {
        return { show: true, reason: 'Approaching daily reply limit' };
      }
      if (stats.keywordsUsed >= limits.maxKeywords) {
        return { show: true, reason: 'Keyword limit reached' };
      }
    }

    return { show: false };
  }
}
