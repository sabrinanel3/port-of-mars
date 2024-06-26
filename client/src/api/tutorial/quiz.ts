import { AjaxResponseError } from "@port-of-mars/client/plugins/ajax";
import { url } from "@port-of-mars/client/util";

export class QuizAPI {
  private ajax!: any;

  connect(ajax: any) {
    this.ajax = ajax;
  }

  //hold the endpoint
  get quizSubmissionEndpoint() {
    return url("/quiz/submission");
  }

  //set the submission id
  public setSubmissionId(submissionId: number) {
    this.ajax.setSubmissionId(submissionId);
  }

  //set submission data
  public setQuizSubmissionData(data: { submissionId: number; quizQuestions: any }) {
    this.setSubmissionId(data.submissionId);
    console.log("from quiz", data.quizQuestions);
    return data.quizQuestions;
  }

  //initalize the quiz
  public async initalizeQuiz() {
    if (this.ajax.submissionId) {
      const retrieveSubmissionUrl = `${this.quizSubmissionEndpoint}/${this.ajax.submissionId}`;
      console.log(`retrieving quiz submission with id ${this.ajax.submissionId}`);
      return await this.ajax.get(retrieveSubmissionUrl, ({ data }: any) => {
        return this.setQuizSubmissionData(data);
      });
    }
    const createQuizSubmissionUrl = this.quizSubmissionEndpoint;
    return await this.ajax.post(createQuizSubmissionUrl, ({ data }: any) => {
      console.log("creating new quiz submission");
      return this.setQuizSubmissionData(data);
    });
  }

  //check the quiz question
  public async checkQuizQuestion(questionId: number, answer: number): Promise<boolean> {
    // FIXME: extract this and other URLs to shared/routes or elsewhere
    const submitResponseUrl = `${this.quizSubmissionEndpoint}/${this.ajax.submissionId}/${questionId}`;
    return await this.ajax.post(submitResponseUrl, ({ data }: any) => Promise.resolve(data), {
      answer: answer,
    });
  }

  //check for completion
  public async checkQuizCompletion(): Promise<void> {
    // FIXME: extract this and other URLs to shared/routes
    const quizCompletionUrl = url("/quiz/complete");
    // quiz completion endpoint returns an array of incorrect question ids
    let status = [];
    try {
      status = await this.ajax.get(quizCompletionUrl, ({ data }: any) => {
        return data;
      });
      console.log("QUIZ COMPLETION: ");
      console.log(status);
    } catch (e) {
      if (e instanceof AjaxResponseError) {
        const error = e.message;
        this.notifyUserOfError("checkQuizCompletion (response)", error);
      }
    } finally {
      console.log("USER HAS COMPLETED QUIZ:", status);
    }
  }

  //notify of error
  private notifyUserOfError(call: string, error: any): void {
    // TODO: Show server error modal
    console.log(`ERROR FETCHING DATA AT ${call}!`);
    console.log("RESPONSE FROM SERVER: ", error);
  }
}
