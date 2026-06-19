declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string
            callback: (resp: { credential: string }) => void
            auto_select?: boolean
            ux_mode?: string
          }): void
          renderButton(
            el: HTMLElement,
            opts: {
              theme?: string
              size?: string
              width?: number
              text?: string
              shape?: string
            },
          ): void
          prompt(): void
          revoke(hint: string, done: () => void): void
        }
      }
    }
  }
}

export {}
