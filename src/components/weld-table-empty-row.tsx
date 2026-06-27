type WeldTableEmptyRowProps = {
  colSpan: number
}

export function WeldTableEmptyRow({ colSpan }: WeldTableEmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-muted-foreground">
        Записи не найдены.
      </td>
    </tr>
  )
}
