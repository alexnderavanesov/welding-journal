import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Check } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { Button, buttonVariants } from './button'

describe('единый мягкий стиль кнопок', () => {
  it('использует цвета бокового меню, тонкие значки и видимый фокус', () => {
    render(<Button><Check />Сохранить</Button>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveClass(
      'bg-sky-50', 'text-sky-700', 'rounded-xl', 'font-medium',
      'hover:bg-sky-100', 'focus-visible:ring-2', 'focus-visible:ring-sky-300',
      '[&_svg.lucide]:[stroke-width:1.5]',
    )
  })

  it.each([
    ['destructive', 'bg-rose-50', 'text-rose-700', 'focus-visible:ring-rose-300'],
    ['warning', 'bg-amber-50', 'text-amber-800', 'focus-visible:ring-amber-300'],
    ['outline', 'bg-white', 'text-slate-600', 'focus-visible:ring-sky-300'],
    ['secondary', 'bg-slate-100', 'text-slate-600', 'focus-visible:ring-sky-300'],
  ] as const)('сохраняет смысл варианта %s', (variant, background, color, ring) => {
    render(<Button variant={variant}>Действие</Button>)
    expect(screen.getByRole('button')).toHaveClass(background, color, ring)
  })

  it('сохраняет disabled, ref, подписи и обработчики', () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const { rerender } = render(<Button disabled ref={ref} onClick={onClick} aria-busy>Сохранение…</Button>)
    const button = screen.getByRole('button')
    expect(ref.current).toBe(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveClass('disabled:opacity-50', 'disabled:pointer-events-none')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    rerender(<Button ref={ref} onClick={onClick}>Сохранить</Button>)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('не меняет отправку форм и отмену', () => {
    const onSubmit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={onSubmit}><Button>Сохранить</Button><Button type="button">Отмена</Button></form>)
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('объединяет размеры и классы одинаково для компонента и обычных кнопок', () => {
    const className = buttonVariants({ size: 'sm', className: 'h-9 text-xs' })
    render(<><Button size="sm" className="h-9 text-xs">Компонент</Button><button className={className}>Обычная</button></>)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].className).toBe(buttons[1].className)
    expect(buttons[0]).toHaveClass('h-9', 'text-xs', 'rounded-lg')
    expect(buttons[0]).not.toHaveClass('h-8', 'h-10', 'text-sm')
  })
})
