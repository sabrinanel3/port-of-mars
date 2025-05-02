<template>
  <b-modal
    v-model="localVisible"
    centered
    no-stacking
    hide-header
    hide-footer
    no-close-on-backdrop
    body-bg-variant="dark"
  >
    <EventCard :event="event"></EventCard>
    <div v-if="voteType" class="mt-3 p-2">
      <p>Cast Your Vote</p>
      <!-- for personal gain event -->
      <div v-if="voteType === 'yes_no'">
        <b-button variant="success" @click="submitVote('yes')">Yes</b-button>
        <b-button variant="danger" @click="submitVote('no')">No</b-button>
      </div>

      <!-- for compulsive philanthropy event -->
      <div v-else-if="voteType === 'player_single'">
        <div v-for="player in players" :key="player.username">
          <b-button variant="info" @click="submitVote(player.username)">{{
            player.username
          }}</b-button>
        </div>
      </div>
      <!-- for hero pariah event -->
      <div v-else-if="voteType === 'hero_pariah'"></div>
    </div>
    <b-button class="mt-2 w-100" variant="primary" @click="$emit('continue')">Continue</b-button>
  </b-modal>
</template>

<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import EventCard from "@port-of-mars/client/components/sologame/EventCard.vue";
import { EventCardData } from "@port-of-mars/shared/sologame";

@Component({
  components: {
    EventCard,
  },
})
export default class EventModal extends Vue {
  @Prop() event!: EventCardData;
  @Prop({ default: false }) visible!: boolean;
  @Prop({ default: () => [] }) players!: Array<{ username: string }>;

  localVisible = false;
  voteSubmitted = false;

  created() {
    this.localVisible = this.visible;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === " ") {
      this.$emit("continue");
    }
  }

  // avoid mutating visible directly
  @Watch("visible")
  onVisibleChanged(newVal: boolean) {
    this.localVisible = newVal;
  }

  // briefly close the modal when the event changes to show the transition
  @Watch("event.deckCardId")
  async onDeckCardIdChanged() {
    this.localVisible = false;
    await this.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 300));
    this.localVisible = true;
  }

  get voteType(): string | null {
    switch (this.event.clientViewHandler) {
      case "VOTE_YES_NO":
        return "yes_no";
      case "VOTE_FOR_PLAYER_SINGLE":
        return "player_single";
      case "VOTE_FOR_PLAYER_HERO_PARIAH":
        return "hero_pariah";
      default:
        return null;
    }
  }

  submitVote(choice: string) {
    this.voteSubmitted = true;
    console.log("Vote was: ", choice);
    //FIXME: fire voting choice to server later
  }
}
</script>

<style lang="scss"></style>
